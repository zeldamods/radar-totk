#!/usr/bin/env python3

import json
import os
from pathlib import Path
import sys
import glob
from functools import reduce


class ActorLoader:
    def __init__(self, work, rescom):
        self.work = work
        self.rescom = rescom

    def load_json(self, files):
        # files[0] - local file
        # files[1] - "global" file in ResidentCommon
        file = files[0]
        if not os.path.exists(file):
            file = files[1]
            if not os.path.exists(file):
                raise ValueError("file does not exist", file)
        return json.load(open(file, "r"))

    def load_file(self, file, fix_path=True):
        if fix_path:
            file = self.get_path(file)
        raw = self.load_json(file)
        root = raw.get("RootNode")
        if root is None:
            print(raw)
            raise ValueError("RootNode does not exist in", file)
        parent_file = root.get("$parent")
        if parent_file:
            parent = self.load_file(parent_file)
            root = merge(parent, root)
        return root

    def get_path(self, file):
        if file[0] == "?":
            file = file.replace("?", f"{self.work}/", 1)
        file = file.replace(".gyml", ".json").replace(".bgyml", ".json")
        work = file.replace("Work/", f"{self.work}/").replace("?", f"{self.work}/", 1)
        rescom = file.replace("Work/", f"{self.rescom}/").replace(
            "?", f"{self.rescom}/", 1
        )
        return [work, rescom]


def merge(a, b, path=None):
    "merges b into a"
    if path is None:
        path = []
    for key in b:
        if key in a:
            if isinstance(a[key], dict) and isinstance(b[key], dict):
                merge(a[key], b[key], path + [str(key)])
            elif a[key] == b[key]:
                pass
            else:
                a[key] = b[key]
        else:
            a[key] = b[key]
    return a


class Actor:
    def __init__(self, param_file, loader):
        self._param_file = param_file
        self.ActorParam = loader.load_file([self._param_file, ""], fix_path=False)

    def read_component(self, component_name):
        components = self.ActorParam.get("Components")
        if not components:
            return False
        component = components.get(component_name)
        if not component:
            return False
        data = loader.load_file(component)
        components[component_name] = data
        components[component_name]["_file"] = component
        return True

    def readDropTables(self, loader):
        if not self.read_component("DropRef"):
            return None
        rsclist = self.ActorParam["Components"]["DropRef"]["DropTableResourceList"]
        tables = []
        for rsc in rsclist:
            table = loader.load_file(rsc)
            if not "DropTableName" in table:
                table["DropTableName"] = ""
            els = table.get("DropTableElementResourceList")
            table["items"] = [loader.load_file(el) for el in els]
            tables.append(table)
        return tables


def read_actor_drop_tables(actor, loader, table_name=None, clean=True):
    parm = Path(loader.work) / "Actor" / f"{actor}.engine__actor__ActorParam.json"
    if not os.path.exists(parm):
        return None
    item = Actor(parm, loader)

    tables = item.readDropTables(loader)
    if tables is None:
        return None

    if clean:
        for table in tables:
            del table["DropTableElementResourceList"]
            if "$parent" in table:
                del table["$parent"]
            for item in table["items"]:
                if "$parent" in item:
                    del item["$parent"]
    return tables


RESCOM = Path(".") / "Pack" / "ResidentCommon"
outfile = "drop_tables.json"

actors = {}
for actor in glob.glob(str(Path(".") / "Pack" / "Actor" / "*")):
    loader = ActorLoader(Path(actor), RESCOM)
    actor = Path(actor).name
    tables = read_actor_drop_tables(actor, loader)
    if tables is None:
        continue
    actors[actor] = tables

print(f"saving to {outfile}")
json.dump(actors, open(outfile, "w"), indent=2)
