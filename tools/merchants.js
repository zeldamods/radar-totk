import * as fs from 'fs';
import * as path from 'path';

function find_edges(rails) {
    const edges = []
    for(const r of Object.values(rails)) {
        const n = r.Points.length;
        const b = find_internal_branches(r)
        let prev = 0
        for(const k of b.sort((a,b) => a- b)) {
            if(prev != k) {
                const dist = distance(rails, r.Hash, prev, r.Hash, k)
                edges.push([r.Hash, prev, r.Hash, k, dist])
            }
            prev = k
            const conns = r.Points[k].Connections || []
            for(const c of conns) {
                const dist = distance(rails, r.Hash, k, c.RailHash, c.RailPointIndex)
                edges.push([r.Hash, k, c.RailHash, c.RailPointIndex, dist])
            }
        }
        if(prev != n-1) {
            const dist = distance(rails, r.Hash, prev, r.Hash, n-1)
            edges.push([r.Hash, prev, r.Hash, n-1, dist])
        }
    }
    return edges
}

function dijkstra(g, source, target) {
    const LARGE = 1e16;
    const node_keys = g.nodes();
    const dist = {};
    const prev = {};
    const queue = {};
    for(const v of node_keys) {
        dist[v] = LARGE;
        prev[v] = undefined;
        queue[v] = 0;
    }
    dist[source] = 0;
    while(Object.keys(queue).length > 0) {
        let u = undefined;
        let min_dist = LARGE;
        for(const k of Object.keys(queue)) {
            const v = dist[k];
            if(v < min_dist) {
                min_dist = v;
                u = k;
            }
        }
        if(u === undefined) {
            return []
        }
        delete queue[u]
        if(u == target) {
            let s = [];
            if(prev[u] || u == source) {
                while(u) {
                    s.push(u)
                    u = prev[u];
                }
            }
            return s;
        }
        for(const v of g.neighbors(u)) {
            if(!(v in queue))
                continue
            let alt = dist[u] + graph.get_dist(u,v);
            if(alt < dist[v]) {
                dist[v] = alt
                prev[v] = u
            }
        }
    }
    return []
}

class Graphx {
    constructor(connections) {
        this.graph = {}
        this.directed = false;
        this.dist = {}
        this.add_connections(connections)
    }
    add_connections(connections) {
        for(const v of connections) {
            this.add([v[0], v[1]], [v[2], v[3]], v[4])
        }
    }
    set_dist(n1, n2, dist) {
        if(!(n1 in this.dist))
            this.dist[n1] = {}
        this.dist[n1][n2] = dist;
    }
    add(n1, n2, dist) {
        if(!(n1 in this.graph))
            this.graph[n1] = new Set();
        this.graph[n1].add( n2 )
        this.set_dist(n1, n2, dist)
        if(!this.directed) {
            if(!(n2 in this.graph))
                this.graph[n2] = new Set()
            this.graph[n2].add( n1 )
            this.set_dist(n2,n1,dist)
        }
    }
    nodes() {
        return Object.keys(this.graph)
    }
    get_dist(n1, n2) {
        return this.dist[n1][n2]
    }
    neighbors(n1) {
        return this.graph[n1]
    }
}
function distance(rails, h1, k1, h2, k2) {
    if(h1 == h2) {
        if(k1 == k2)
            return 0
        if(k2 < k1)
            [k1,k2] = [k2,k1]
        const r = rails[h1]
        let dist = 0
        for(let k = k1; k < k2; k++)
            dist += r.Points[k].NextDistance;
        return dist;
    }
    if(!rails[h1]) {
        return 1e16
    }
    if(!rails[h2]) {
        return 1e16
    }
    const p1 = rails[h1].Points[k1].Translate;
    const p2 = rails[h2].Points[k2].Translate;
    if(!p1 || !p2)
        return 1e16
    let dist = 0
    for(let i = 0; i < 3; i++)
        dist += Math.pow(p1[i] - p2[i], 2);
    dist = Math.sqrt(dist)
    if(dist > 2.0)
        console.log('Distance > 2 between', h1,k1,h2,k2,dist)
    return dist;
}
function find_checkpoints(rails) {
    const cps = {};
    for(const [rail_name, rail] of Object.entries(rails)) {
        for(let i = 0; i < rail.Points.length; i++) {
            const p = rail.Points[i];
            if(!p.Dynamic)
                continue
            const name = rail.Points[i].Dynamic.CheckPointName;
            if(!name)
                continue
            if(!(name in cps))
                cps[name] = []
            cps[name].push([rail_name, i])
        }
    }
    return cps;
}

function find_internal_branches(rail) {
    const b = []
    const pts = rail.Points;
    for(let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if(p.Connections || (p.Dynamic && p.Dynamic.CheckPointName))
            b.push(i)
    }
    return b
}
export function dist(a, b) {
    const dx = a[0]-b[0]
    const dy = a[1]-b[1]
    const dz = a[2]-b[2]
    return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

const range = (start, stop, step) =>
      Array.from({ length: (stop - start) / step + 1}, (_, i) => start + (i * step))


function route(from_s, to_s, graph, rails) {
    const from = checkpoints[from_s]
    const to   = checkpoints[to_s]

    let segs = dijkstra(graph, from, to);
    let fake = {
        Dynamic: {
            DisableRenderMap: true,
            IsEnableHorseTrace: true,
            IsWalkable: true,
        },
        Gyaml: 'Route',
        Hash: '0000000000000000000',
        IsClosed: false,
        Name: 'Route',
        Points: []
    }

    segs.reverse()

    for(let i = 0; i < segs.length - 1; i++) {
        const a = segs[i].split(",");
        const b = segs[i+1].split(",");
        const r1 = rails[a[0]];
        const r2 = rails[b[0]];
        a[1] = parseInt(a[1])
        b[1] = parseInt(b[1])

        if(a[0] == b[0]) {
            let dir = 1;
            if(a[1] > b[1])
                dir = -1;
            const idx = range(a[1],b[1], dir);

            for(const i of idx) {
                const p = structuredClone(r1.Points[i])
                if(dir == -1) {
                    const tmp = p.Control0
                    p.Control0 = p.Control1
                    p.Control1 = tmp
                }
                fake.Points.push( p )
            }
        }
    }
    return cleanRailPoints(fake);
}

function cleanRailPoints(fake) {
    // Remove control points for points with minimal distance
    //   These are normally connections
    for(let i = 0; i < fake.Points.length - 1; i++) {
        const p0 = fake.Points[i];
        const p1 = fake.Points[i+1];
        const d = dist(p0.Translate, p1.Translate)
        if(d < 2.5) { // Guess at minimum distance
            fake.Points[i+0].Control1 = undefined;
            fake.Points[i+1].Control0 = undefined;
        }
    }
    return fake;
}


function fromDir(startPath, filter) {
    if (!fs.existsSync(startPath)) {
        console.log("directory does not exist: ", startPath);
        return;
    }
    let out = []
    const files = fs.readdirSync(startPath);
    for (let i = 0; i < files.length; i++) {
        const filename = path.join(startPath, files[i]);
        if(filter(filename)) {
            out.push(filename)
        }
    }
    return out
};

function get(root, ...args) {
    let v = root;
    for(const arg of args) {
        if(!arg in v) {
            return undefined
        }
        v = v[arg]
    }
    return v
}
let hash_id = BigInt(9087595544963973120)
function hash_num() {
    const h = hash_id;
    hash_id = hash_id + BigInt(1)
    return h
}

const prices = JSON.parse(fs.readFileSync("prices.json", "utf-8"))
const rails = JSON.parse(fs.readFileSync("rails_route.json","utf-8"))
const merchants = fs.readFileSync("TravelerParamActor.txt","utf-8")
      .split("\n")
      .map(x => x.trim())
      .filter(x => x.length)

const checkpoints = find_checkpoints(rails);
const edges = find_edges(rails);
const graph = new Graphx(edges)

const base0 = path.join("..", "0.0.1-Json", "Pack", "Actor")

let banc = {
    Actors: [],
    Rails: []
}

for(const name of merchants) {
    //if(name != 'Npc_Road_043')
    //    continue
    const base = path.join(base0, name)
    const param_path = path.join(base, "Actor",
                                 `${name}.engine__actor__ActorParam.json`)
    const param = JSON.parse(fs.readFileSync(param_path, 'utf-8'))
    let trav_path = get(param, "RootNode", "Components", "TravelerRef")
    if(!trav_path)
        continue
    trav_path = trav_path.replace(".bgyml", ".json")
    if(trav_path[0] == "?") {
        trav_path = path.join(base, trav_path.slice(1))
    }
    const trav = JSON.parse(fs.readFileSync(trav_path, 'utf-8')).RootNode
    let rail = undefined;
    for (let i = 0; i < trav.CheckPointSetting.length-1; i++) {
        let tmp = route(trav.CheckPointSetting[i].Name,
                        trav.CheckPointSetting[i+1].Name,
                        graph, rails)
        if(!rail)
            rail = tmp;
        else
            rail.Points.push( ... tmp.Points )
    }
    rail = cleanRailPoints(rail)
    rail.Hash = hash_num().toString()
    banc.Rails.push( rail )
    console.error('name',name, banc.Rails.length-1);
    
    for(const pt of trav.CheckPointSetting) {
        const h = hash_num().toString();
        let cp_name = pt.Name
        let cp = checkpoints[cp_name][0]
        let p = rails[cp[0]].Points[cp[1]].Translate
        const m = {
            Gyaml: name,
            Hash: h,
            Dynamic: {
                Type: trav.Type,
                CheckPointSettings: trav.CheckPointSetting.map(x => x.Name),
                StartCheckPoint: trav.StartCheckPoint,
                EndCheckPoint: trav.EndCheckPoint,
            },
            Phive: { Placement: { ID: h } },
            Rails: [{
                Dst: rail.Hash, Name: "GuideRef"
            }],
            Translate: p,
        }
        banc.Actors.push(m)
    }
}
fs.writeFileSync("merchants.json", JSON.stringify(banc, null, 2))

function filt(filename) {
    const stat = fs.lstatSync(filename);
    return stat.isDirectory()
}

let shop = {}
for(const dir of fromDir(base0, filt)) {
    const name = dir.split("/").at(-1)
    const param_path = path.join(dir, "Actor", `${name}.engine__actor__ActorParam.json`)
    if(!fs.existsSync(param_path))
        continue
    let param = JSON.parse(fs.readFileSync(param_path, 'utf-8'))
    let shop_path = get(param, "RootNode", "Components", "ShopRef")
    if(!shop_path) {
        let parent = get(param, "RootNode","$parent")
        if(!parent)
            continue
        if(parent.startsWith("Work")) {
            parent = parent.replace("Work", dir).replace(".gyml",".json")
        }
        if(!fs.existsSync(parent))
            continue
        param = JSON.parse(fs.readFileSync(parent, 'utf-8'))
        shop_path = get(param, "RootNode", "Components", "ShopRef")
        if(!shop_path)
            continue
    }
    shop_path = shop_path.replace(".bgyml", ".json")
    const shop_path0 = shop_path;
    if(shop_path[0] == "?") {
        shop_path = path.join(dir, shop_path0.slice(1))
    }
    if(!fs.existsSync(shop_path)) {
        const act = shop_path.split("/").at(-1).split(".").at(0)
        shop_path = path.join(base0, "Pack","Actor", act, ...shop_path0.slice(1))
        if(!fs.existsSync(shop_path)) {
            continue
        }
    }

    const shop_data = JSON.parse(fs.readFileSync(shop_path, 'utf-8')).RootNode
    console.log('shop_data', name)
    shop[name] = {
        items: shop_data.GoodsList.map(item => {
            item.Name = item.Actor.split("/").at(-1).split(".").at(0);
            if(item.PaymentList && item.PaymentList.length) {
                if(item.PaymentList.length > 1) {
                    console.error("Payment List for item > 1")
                    process.exit(0)
                }
                item.Currency = item.PaymentList[0].Actor.split("/").at(-1).split(".").at(0)
                item.BasePrice = item.PaymentList[0].Num
            } else {
                item.BasePrice = prices[item.Name]
            }
            if(!item.Currency) {
                item.Currency = "Rupee"
            }
            item.StockNumShareTargetList = undefined;
            item.Actor = undefined
            item.Price = item.BasePrice + ((item.PriceOffset) ? item.PriceOffset : 0)
            return Object.assign({}, item)
        })
    }

}

fs.writeFileSync("shop_data.json", JSON.stringify(shop, null, 2))

process.exit(0)
if(false) {
    const from_s  = 'KY_03_START';
    const to_s = 'KY_03_GOAL';
    const fake = route(from_s, to_s, graph, rails)
    const verbose = false
    const pts = railPath(fake, verbose)
    if(!verbose) {
        for(const p of pts) {
            console.log(p.map(x => x.toString()).join(","))
        }
    }
}
