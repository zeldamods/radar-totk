#!/usr/bin/env

import json
import sqlite3

names = json.load(open("names.json","r"))

con = sqlite3.connect("map.db")
cur = con.cursor()
res = cur.execute('select distinct(unit_config_name) from objs')
for row in res:
    if not row[0] in names:
        print(f"{row[0]}, ")
