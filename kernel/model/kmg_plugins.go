// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// KMG: plugins that ship with KMG.

package model

import (
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
)

// InstallBundledPlugins copies the plugins in <working dir>/kmg-plugins into the workspace.
// A plugin is installed (and enabled) the first time, and updated when KMG ships a newer version.
// The versions already handed out are recorded in the workspace, so a plugin the user removed stays removed
// until KMG ships a newer version of it.
func InstallBundledPlugins() {
	bundledDir := filepath.Join(util.WorkingDir, "kmg-plugins")
	entries, err := os.ReadDir(bundledDir)
	if err != nil {
		if !os.IsNotExist(err) {
			logging.LogErrorf("read bundled plugins [%s] failed: %s", bundledDir, err)
		}
		return
	}

	recordPath := filepath.Join(util.DataDir, "storage", "petal", "kmg-bundled.json")
	record := map[string]string{}
	if data, readErr := filelock.ReadFile(recordPath); readErr == nil {
		if err = gulu.JSON.UnmarshalJSON(data, &record); err != nil {
			logging.LogWarnf("parse [%s] failed: %s", recordPath, err)
			record = map[string]string{}
		}
	}

	changed := false
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		version := bundledPluginVersion(filepath.Join(bundledDir, name))
		if version == "" {
			continue
		}
		handedOut := record[name]
		if handedOut != "" && 0 <= semver.Compare("v"+handedOut, "v"+version) {
			continue
		}

		installedDir := filepath.Join(util.DataDir, "plugins", name)
		installedVersion := bundledPluginVersion(installedDir)
		if installedVersion != "" && 0 <= semver.Compare("v"+installedVersion, "v"+version) {
			record[name] = version
			changed = true
			continue
		}
		if handedOut != "" && installedVersion == "" {
			// Removed by the user; a newer bundled version brings it back.
			logging.LogInfof("reinstalling bundled plugin [%s] %s", name, version)
		}

		if err = os.RemoveAll(installedDir); err != nil {
			logging.LogErrorf("remove old plugin [%s] failed: %s", installedDir, err)
			continue
		}
		if err = filelock.Copy(filepath.Join(bundledDir, name), installedDir); err != nil {
			logging.LogErrorf("install bundled plugin [%s] failed: %s", name, err)
			continue
		}
		if installedVersion == "" {
			if _, err = SetPetalEnabled(name, true); err != nil {
				logging.LogErrorf("enable bundled plugin [%s] failed: %s", name, err)
			}
		}
		logging.LogInfof("installed bundled plugin [%s] %s", name, version)
		record[name] = version
		changed = true
	}

	if !changed {
		return
	}
	data, err := gulu.JSON.MarshalIndentJSON(record, "", "\t")
	if err != nil {
		return
	}
	if err = os.MkdirAll(filepath.Dir(recordPath), 0755); err != nil {
		logging.LogErrorf("create [%s] failed: %s", filepath.Dir(recordPath), err)
		return
	}
	if err = filelock.WriteFile(recordPath, data); err != nil {
		logging.LogErrorf("write [%s] failed: %s", recordPath, err)
	}
}

func bundledPluginVersion(dir string) string {
	data, err := os.ReadFile(filepath.Join(dir, "plugin.json"))
	if err != nil {
		return ""
	}
	manifest := struct {
		Version string `json:"version"`
	}{}
	if err = gulu.JSON.UnmarshalJSON(data, &manifest); err != nil || !semver.IsValid("v"+manifest.Version) {
		return ""
	}
	return manifest.Version
}
