/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2023, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

import GlobalTimeContext from "./GlobalTimeContext";
import IndependentTimeContext from "@/api/time/IndependentTimeContext";
import {FIXED_MODE_KEY, REALTIME_MODE_KEY} from "@/api/time/constants";

/**
* The public API for setting and querying the temporal state of the
* application. The concept of time is integral to Open MCT, and at least
* one {@link TimeSystem}, as well as some default time bounds must be
* registered and enabled via {@link TimeAPI.addTimeSystem} and
* {@link TimeAPI.timeSystem} respectively for Open MCT to work.
*
* Time-sensitive views will typically respond to changes to bounds or other
* properties of the time conductor and update the data displayed based on
* the temporal state of the application. The current time bounds are also
* used in queries for historical data.
*
* The TimeAPI extends the GlobalTimeContext which in turn extends the TimeContext/EventEmitter class. A number of events are
* fired when properties of the time conductor change, which are documented
* below.
*
* @interface
* @memberof module:openmct
*/
class TimeAPI extends GlobalTimeContext {
    constructor(openmct) {
        super();
        this.openmct = openmct;
        this.independentContexts = new Map();
    }

    /**
     * A TimeSystem provides meaning to the values returned by the TimeAPI. Open
     * MCT supports multiple different types of time values, although all are
     * intrinsically represented by numbers, the meaning of those numbers can
     * differ depending on context.
     *
     * A default time system is provided by Open MCT in the form of the {@link UTCTimeSystem},
     * which represents integer values as ms in the Unix epoch. An example of
     * another time system might be "sols" for a Martian mission. TimeSystems do
     * not address the issue of converting between time systems.
     *
     * @typedef {object} TimeSystem
     * @property {string} key A unique identifier
     * @property {string} name A human-readable descriptor
     * @property {string} [cssClass] Specify a css class defining an icon for
     * this time system. This will be visible next to the time system in the
     * menu in the Time Conductor
     * @property {string} timeFormat The key of a format to use when displaying
     * discrete timestamps from this time system
     * @property {string} [durationFormat] The key of a format to use when
     * displaying a duration or relative span of time in this time system.
     */

    /**
     * Register a new time system. Once registered it can activated using
     * {@link TimeAPI.timeSystem}, and can be referenced via its key in [Time Conductor configuration](@link https://github.com/nasa/openmct/blob/master/API.md#time-conductor).
     * @memberof module:openmct.TimeAPI#
     * @param {TimeSystem} timeSystem A time system object.
     */
    addTimeSystem(timeSystem) {
        this.timeSystems.set(timeSystem.key, timeSystem);
    }

    /**
     * @returns {TimeSystem[]}
     */
    getAllTimeSystems() {
        return Array.from(this.timeSystems.values());
    }

    /**
     * Clocks provide a timing source that is used to
     * automatically update the time bounds of the data displayed in Open MCT.
     *
     * @typedef {object} Clock
     * @memberof openmct.timeAPI
     * @property {string} key A unique identifier
     * @property {string} name A human-readable name. The name will be used to
     * represent this clock in the Time Conductor UI
     * @property {string} description A longer description, ideally identifying
     * what the clock ticks on.
     * @property {function} currentValue Returns the last value generated by a tick, or a default value
     * if no ticking has yet occurred
     * @see {LocalClock}
     */

    /**
     * Register a new Clock.
     * @memberof module:openmct.TimeAPI#
     * @param {Clock} clock
     */
    addClock(clock) {
        this.clocks.set(clock.key, clock);
    }

    /**
     * @memberof module:openmct.TimeAPI#
     * @returns {Clock[]}
     * @memberof module:openmct.TimeAPI#
     */
    getAllClocks() {
        return Array.from(this.clocks.values());
    }

    /**
     * Get or set an independent time context which follows the TimeAPI timeSystem,
     * but with different offsets for a given domain object
     * @param {key | string} key The identifier key of the domain object these offsets are set for
     * @param {ClockOffsets | TimeBounds} value This maintains a sliding time window of a fixed width that automatically updates
     * @param {key | string} clockKey the real time clock key currently in use
     * @memberof module:openmct.TimeAPI#
     * @method addIndependentTimeContext
     */
    addIndependentContext(key, value, clockKey) {
        let timeContext = this.getIndependentContext(key);
        // let upstreamClock;
        // if (timeContext.upstreamTimeContext) {
        //     upstreamClock = timeContext.upstreamTimeContext.getClock();
        // }

        //stop following upstream time context since the view has it's own
        timeContext.resetContext();

        if (clockKey) {
            timeContext.setMode(REALTIME_MODE_KEY);
            timeContext.setClock(clockKey, value);
        } else {
            timeContext.setMode(FIXED_MODE_KEY);
            //TODO: Should the clock be stopped here?
            // timeContext.stopClock();
            //upstream clock was active, but now we don't have one
            // if (upstreamClock) {
            //     // timeContext.emit('clockChanged', timeContext.activeClock);
            // }

            timeContext.setBounds(value);
        }

        // Notify any nested views to update, pass in the viewKey so that particular view can skip getting an upstream context
        this.emit('refreshContext', key);

        return () => {
            //follow any upstream time context
            this.emit('removeOwnContext', key);
        };
    }

    /**
     * Get the independent time context which follows the TimeAPI timeSystem,
     * but with different offsets.
     * @param {key | string} key The identifier key of the domain object these offsets
     * @memberof module:openmct.TimeAPI#
     * @method getIndependentTimeContext
     */
    getIndependentContext(key) {
        return this.independentContexts.get(key);
    }

    /**
     * Get the a timeContext for a view based on it's objectPath. If there is any object in the objectPath with an independent time context, it will be returned.
     * Otherwise, the global time context will be returned.
     * @param { Array } objectPath The view's objectPath
     * @memberof module:openmct.TimeAPI#
     * @method getContextForView
     */
    getContextForView(objectPath) {
        if (!objectPath || !Array.isArray(objectPath)) {
            throw new Error('No objectPath provided');
        }

        const viewKey = objectPath.length && this.openmct.objects.makeKeyString(objectPath[0].identifier);

        if (!viewKey) {
            // Return the global time contex
            return this;
        }

        let viewTimeContext = this.getIndependentContext(viewKey);

        if (!viewTimeContext) {
            // If the context doesn't exist yet, create it.
            viewTimeContext = new IndependentTimeContext(this.openmct, this, objectPath);
            this.independentContexts.set(viewKey, viewTimeContext);
        } else {
            // If it already exists, compare the objectPath to see if it needs to be updated.
            const currentPath = this.openmct.objects.getRelativePath(viewTimeContext.objectPath);
            const newPath = this.openmct.objects.getRelativePath(objectPath);

            if (currentPath !== newPath) {
                // If the path has changed, update the context.
                this.independentContexts.delete(viewKey);
                viewTimeContext = new IndependentTimeContext(this.openmct, this, objectPath);
                this.independentContexts.set(viewKey, viewTimeContext);
            }
        }

        return viewTimeContext;
    }
}

export default TimeAPI;
