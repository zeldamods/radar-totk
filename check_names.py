#!/usr/bin/env

import json
import sqlite3

DROP_ACTOR = 1
DROP_TABLE = 2


names = json.load(open("names.json","r"))

missing = {}
with open("missing.csv", "r") as f:
    for line in f:
        if len(line.strip()) == 0:
            continue
        if line.strip()[0] == '#':
            continue
        v = [x.strip() for x in line.split(",")]
        key, val = v[0], v[1]
        missing[key] = val

con = sqlite3.connect("map.db")
cur = con.cursor()
res = cur.execute('select distinct(unit_config_name) from objs')
for row in res:
    if not row[0] in names and not row[0] in missing:
        missing[row[0]] = ""

res = cur.execute('select drops from objs')

for row in res:
    if row[0] is None or len(row[0]) == 0:
        continue
    r = json.loads(row[0])
    if r[0] == DROP_TABLE:
        continue
    drop = r[1]
    if drop and drop not in names and drop not in missing:
        missing[drop] = ""

res = cur.execute('select equip from objs')
for row in res:
    if row[0] is None or len(row[0]) == 0:
        continue
    r = json.loads(row[0])
    for val in r:
        if not val in names and not val in missing:
            missing[val] = ""

print("""# Created make check_names.py to find unit_config_names
#   that do not have matching names in names.json
#   names.json - Created by make_names_list.py from game data
# Edited by hand to add in missing actors, se
#  - $name to reference an existing key
#  - raw string to set a value
# Comments are #
""")
for key in sorted(missing.keys()):
    val = missing[key]
    print(f"{key}, {val}")
