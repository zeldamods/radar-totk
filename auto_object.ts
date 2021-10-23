import fs from 'fs';
import path from 'path';

const beco = require('./beco');
const yaml = require('js-yaml');

import * as util from './app/util';

let parseArgs = require('minimist');

let argv = parseArgs(process.argv);

if (!argv.a) {
  console.log("Error: Must specify a path to directory with ActorLink YAML files");
  console.log("       e.g. % ts-node build.ts -a ../botw/")
  console.log("       YAML data files are available from https://github.com/leoetlino/botw");
  process.exit(1);
}
const botwData = argv.a;

const uType = new yaml.Type('!u', {
  kind: 'scalar', instanceOf: String,
  resolve: function(data: any) { return true; },
  construct: function(data: any) { return data; },
});

let schema = yaml.DEFAULT_SCHEMA.extend([uType]);

function readYAML(filePath: string) {
  let doc: any = null;
  try {
    doc = yaml.load(fs.readFileSync(filePath, 'utf-8'), { schema: schema });
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
  return doc;
}

function real_name(x: string): string {
  if (x in names) {
    return names[x];
  }
  console.log("Missing ", x);
  return x;
}

// Check if the Item has Auto Placement in an Area
function isAutoItem(area: any, atype: string) {
  if (atype == "Insect") {
    return area.NonAutoPlacementInsect == false;
  } else if (atype == "Animal") {
    return area.NonAutoPlacementAnimal == false;
  } else if (atype == "Bird") {
    return area.NonAutoPlacementBird == false;
  } else if (atype == "Material") {
    return area.NonAutoPlacementMaterial == false;
  } else if (atype == "Enemy") {
    return area.NonAutoPlacementEnemy == false;
  } else if (atype == "Fish") {
    return area.NonAutoPlacementFish == false;
  } else if (atype == "Safe") {
    return area.NonEnemySearchPlayer == true;
  }
  return null;
}

// Get Item parts for an Area
function itemParts(area: any, atype: string) {
  let x: number = area.Translate.X;
  let z: number = area.Translate.Z;
  let num = fieldArea.getCurrentAreaNum(x, z);
  if (atype == "Insect") {
    return ndata[num].Insect;
  } else if (atype == "Animal") {
    return ndata[num].Animal;
  } else if (atype == "Bird") {
    return ndata[num].Bird;
  } else if (atype == "Enemy") {
    return ndata[num].Enemy;
  } else if (atype == "Fish") {
    return ndata[num].Fish;
  } else if (atype == "Material") {
    return ndata[num].AutoPlacementMaterial;
  } else if (atype == "Safe") {
    return [];
  }
  return null;
}

// Create and write Auto Placement data for each
function getAutoPlacements(stat: any, atype: string) {
  let color = "pink";
  let out: any = {};
  stat.NonAutoPlacement
    .filter((area: any) => isAutoItem(area, atype))
    .filter((area: any) => itemParts(area, atype))
    .forEach((area: any, n: number) => {
      let parts = itemParts(area, atype);
      let x: number = area.Translate.X;
      let z: number = area.Translate.Z;
      let sx: number = area.Scale.X;
      let sz = area.Scale.Z;
      let sy = area.Scale.Y;
      let angle = area.RotateY;
      let shape: string = area.Shape;
      let num: number = fieldArea.getCurrentAreaNum(x, z);

      parts = parts.sort((a: any, b: any) => b.num - a.num);
      parts = parts.map((item: any) => `${real_name(item.name)}: ${item.num} %`);

      let key = `${atype} RNG<br/>${parts.join('<br/>')}<br/>Field Map Area ${num}<br/>#${n}`;
      if (atype == "Safe") {
        key = `${atype} #${n}`;
      }
      let geom: any = {
        shape: shape,
        loc: [area.Translate.X, area.Translate.Y, area.Translate.Z],
        scale: [area.Scale.X, area.Scale.Y, area.Scale.Z],
        rotate: [0, angle, 0],
        color: color,
      };
      out[key] = geom;
    });
  let filename = `Auto${atype}.json`;
  console.log(`Writing ${filename} ...`);
  fs.writeFileSync(filename, JSON.stringify(out), 'utf8');
}


// Read in FieldMapArea, AreaData, Static.mubin, and names.json
const fieldArea = new beco.Beco(path.join(util.APP_ROOT, 'content', 'ecosystem', 'FieldMapArea.beco'));
let data = readYAML(path.join(botwData, '..', 'Ecosystem', 'AreaData.yml'));
let stat = readYAML(path.join(botwData, '..', 'Map', 'MainField', 'Static.mubin.yml'));
let names: any = JSON.parse(fs.readFileSync(path.join(util.APP_ROOT, 'content', 'names.json'), 'utf8'));

// These names are not in names.json
names['Animal_Insect_EP'] = 'Sunset Firefly?';
names['BrokenSnowBall'] = 'Broken SnowBall';

// Create [areaNumber] = areaData 
let ndata: any = {};
data.forEach((v: any) => {
  ndata[v.AreaNumber] = v;
});

let items = ["Animal", "Bird", "Enemy", "Fish", "Insect", "Material", "Safe"];
items.forEach(item => getAutoPlacements(stat, item));
