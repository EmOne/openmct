<!--
 Open MCT, Copyright (c) 2014-2024, United States Government
 as represented by the Administrator of the National Aeronautics and Space
 Administration. All rights reserved.

 Open MCT is licensed under the Apache License, Version 2.0 (the
 "License"); you may not use this file except in compliance with the License.
 You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0.

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 License for the specific language governing permissions and limitations
 under the License.

 Open MCT includes source code licensed under additional open source
 licenses. See the Open Source Licenses file (LICENSES.md) included with
 this source code distribution or the Licensing information page available
 at runtime from the About dialog for additional information.
-->
<template>
  <div class="c-tree-and-search l-shell__tree">
    <ul class="c-tree-and-search__tree c-tree c-tree__scrollable" aria-label="Recent Objects">
      <RecentObjectsListItem
        v-for="recentObject in recentObjects"
        :key="recentObject.navigationPath"
        :object-path="recentObject.objectPath"
        :navigation-path="recentObject.navigationPath"
        :domain-object="recentObject.domainObject"
        @open-and-scroll-to="openAndScrollTo($event)"
      />
    </ul>
  </div>
</template>

<script>
const MAX_RECENT_ITEMS = 20;
const LOCAL_STORAGE_KEY__RECENT_OBJECTS = 'mct-recent-objects';
import RecentObjectsListItem from './RecentObjectsListItem.vue';
export default {
  name: 'RecentObjectsList',
  components: {
    RecentObjectsListItem
  },
  inject: ['openmct'],
  props: {},
  emits: ['open-and-scroll-to', 'set-clear-button-disabled'],
  data() {
    return {
      recents: []
    };
  },
  computed: {
    recentObjects() {
      return this.recents.filter((recentObject) => {
        return recentObject.location !== null;
      });
    }
  },
  mounted() {
    this.compositionCollections = {};
    this.nameChangeListeners = {};
    this.openmct.router.on('change:path', this.onPathChange);
    this.getSavedRecentItems();
  },
  unmounted() {
    this.openmct.router.off('change:path', this.onPathChange);
    Object.values(this.nameChangeListeners).forEach((unlisten) => {
      unlisten();
    });
  },
  methods: {
    addNameListenerFor(domainObject) {
      const keyString = this.openmct.objects.makeKeyString(domainObject.identifier);
      if (!this.nameChangeListeners[keyString]) {
        this.nameChangeListeners[keyString] = this.openmct.objects.observe(
          domainObject,
          'name',
          this.updateRecentObjectName.bind(this, keyString)
        );
      }
    },
    updateRecentObjectName(keyString, newName) {
      this.recents = this.recents.map((recentObject) => {
        if (
          this.openmct.objects.makeKeyString(recentObject.domainObject.identifier) === keyString
        ) {
          return {
            ...recentObject,
            domainObject: { ...recentObject.domainObject, name: newName }
          };
        }
        return recentObject;
      });
    },
    removeNameListenerFor(domainObject) {
      const keyString = this.openmct.objects.makeKeyString(domainObject.identifier);
      if (this.nameChangeListeners[keyString]) {
        this.nameChangeListeners[keyString]();
        delete this.nameChangeListeners[keyString];
      }
    },
    /**
     * Add a composition collection to the map and register its remove handler
     * @param {string} navigationPath
     */
    addCompositionListenerFor(navigationPath) {
      this.compositionCollections[navigationPath].removeHandler =
        this.compositionRemoveHandler(navigationPath);
      this.compositionCollections[navigationPath].collection.on(
        'remove',
        this.compositionCollections[navigationPath].removeHandler
      );
    },
    /**
     * Handler for composition collection remove events.
     * Removes the object and any of its children from the recents list.
     * @param {string} navigationPath
     */
    compositionRemoveHandler(navigationPath) {
      /**
       * @param {import('../../api/objects/ObjectAPI').Identifier | string} identifier
       */
      return (identifier) => {
        // Construct the navigationPath of the removed object itself
        const removedNavigationPath = `${navigationPath}/${this.openmct.objects.makeKeyString(
          identifier
        )}`;

        // Remove the object and any of its children from the recents list
        this.recents = this.recents.filter((recentObject) => {
          return !recentObject.navigationPath.includes(removedNavigationPath);
        });

        this.removeCompositionListenerFor(removedNavigationPath);
      };
    },
    /**
     * Restores the RecentObjects list from localStorage, retrieves composition collections,
     * and registers composition listeners for composable objects.
     */
    getSavedRecentItems() {
      const savedRecentsString = localStorage.getItem(LOCAL_STORAGE_KEY__RECENT_OBJECTS);
      const savedRecents = savedRecentsString ? JSON.parse(savedRecentsString) : [];

      // Get composition collections and add composition listeners for composable objects
      savedRecents.forEach((recentObject) => {
        const { domainObject, navigationPath } = recentObject;
        this.addNameListenerFor(domainObject);
        if (this.shouldTrackCompositionFor(domainObject)) {
          this.compositionCollections[navigationPath] = {};
          this.compositionCollections[navigationPath].collection =
            this.openmct.composition.get(domainObject);
          this.addCompositionListenerFor(navigationPath);
        }
      });

      this.recents = savedRecents;
    },
    /**
     * Handler for 'change:path' router events.
     * Adds or moves to the top the object at the given path to the recents list.
     * Registers compositionCollection listeners for composable objects.
     * Enforces the MAX_RECENT_ITEMS limit.
     * @param {string} navigationPath
     */
    async onPathChange(navigationPath) {
      // Short-circuit if the path is not a navigationPath
      if (!navigationPath.startsWith('/browse/')) {
        return;
      }

      const objectPath = await this.openmct.objects.getRelativeObjectPath(navigationPath);
      if (!objectPath.length) {
        return;
      }

      const domainObject = objectPath[0];

      // Get rid of '/ROOT' if it exists in the navigationPath.
      // Handles for the case of navigating to "My Items" from a RecentObjectsListItem.
      // Could lead to dupes of "My Items" in the RecentObjectsList if we don't drop the 'ROOT' here.
      if (navigationPath.includes('/ROOT')) {
        navigationPath = navigationPath.replace('/ROOT', '');
      }

      if (this.shouldTrackCompositionFor(domainObject, navigationPath)) {
        this.compositionCollections[navigationPath] = {};
        this.compositionCollections[navigationPath].collection =
          this.openmct.composition.get(domainObject);
        this.addCompositionListenerFor(navigationPath);
      }

      // Don't add deleted objects to the recents list
      if (domainObject?.location === null) {
        return;
      }

      this.addNameListenerFor(domainObject);

      // Move the object to the top if its already existing in the recents list
      const existingIndex = this.recents.findIndex((recentObject) => {
        return navigationPath === recentObject.navigationPath;
      });
      if (existingIndex !== -1) {
        this.recents.splice(existingIndex, 1);
      }

      this.recents.unshift({
        objectPath,
        navigationPath,
        domainObject
      });

      // Enforce a max number of recent items
      while (this.recents.length > MAX_RECENT_ITEMS) {
        const poppedRecentItem = this.recents.pop();
        this.removeCompositionListenerFor(poppedRecentItem.navigationPath);
        this.removeNameListenerFor(poppedRecentItem.domainObject);
      }

      this.setSavedRecentItems();
    },
    /**
     * Delete the composition collection and unregister its remove handler
     * @param {string} navigationPath
     */
    removeCompositionListenerFor(navigationPath) {
      if (this.compositionCollections[navigationPath]) {
        this.compositionCollections[navigationPath].collection.off(
          'remove',
          this.compositionCollections[navigationPath].removeHandler
        );
        delete this.compositionCollections[navigationPath];
      }
    },
    openAndScrollTo(navigationPath) {
      this.$emit('open-and-scroll-to', navigationPath);
    },
    /**
     * Saves the Recent Objects list to localStorage.
     */
    setSavedRecentItems() {
      localStorage.setItem(LOCAL_STORAGE_KEY__RECENT_OBJECTS, JSON.stringify(this.recents));
      // send event to parent for enabled button
      if (this.recents.length === 1) {
        this.$emit('set-clear-button-disabled', false);
      }
    },
    /**
     * Returns true if the `domainObject` supports composition and we are not already
     * tracking its composition.
     * @param {import('openmct').DomainObject} domainObject
     * @param {string} navigationPath
     */
    shouldTrackCompositionFor(domainObject, navigationPath) {
      return (
        this.compositionCollections[navigationPath] === undefined &&
        this.openmct.composition.supportsComposition(domainObject)
      );
    },
    /**
     * Clears the Recent Objects list in localStorage and in the component.
     * Before clearing, prompts the user to confirm the action with a dialog.
     */
    clearRecentObjects() {
      const dialog = this.openmct.overlays.dialog({
        title: 'Clear Recently Viewed Objects',
        iconClass: 'alert',
        message:
          'This action will clear the Recently Viewed Objects list. Are you sure you want to continue?',
        buttons: [
          {
            label: 'OK',
            callback: () => {
              localStorage.removeItem(LOCAL_STORAGE_KEY__RECENT_OBJECTS);
              Object.values(this.nameChangeListeners).forEach((unlisten) => {
                unlisten();
              });
              this.recents = [];
              dialog.dismiss();
              this.$emit('set-clear-button-disabled', true);
            }
          },
          {
            label: 'Cancel',
            callback: () => {
              dialog.dismiss();
            }
          }
        ]
      });
    }
  }
};
</script>
