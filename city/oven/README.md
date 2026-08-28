# The oven

Bakes the 3D models of a city kit into the **isometric sprites** Pixi draws. It
exists because the good CC0 kits are all 3D, and live 3D reads worse: with a
hundred and fifty parcels there is always a building hiding another one. This way
you get a game's art and an isometric map's legibility.

The `.glb` files are **not in the repo**: they are 3.6 MB, re-downloadable, and
there is no reason to version them. What is versioned is the baked PNGs, which is
what the web serves.

## Baking again

```bash
# 1. the kit (CC0, no attribution required)
curl -sL -o /tmp/kit.zip \
  "https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip"
unzip -o -j /tmp/kit.zip "Models/GLB format/*.glb" -d city/oven/glb

# 2. the oven and the collector
(cd city/web && npx --yes esbuild src/oven.ts --bundle --format=esm --outfile=../oven/oven.js)
ls city/oven/glb | sed 's/\.glb$//' | python3 -c "import sys,json,re;ms=[l.strip() for l in sys.stdin if l.strip()];p='city/oven/oven.html';h=open(p).read();open(p,'w').write(re.sub(r'window.__modelos = .*','window.__modelos = '+json.dumps(ms),h))"
(cd city/oven && python3 -m http.server 8811 &) ; python3 city/oven/collect.py &

# 3. open http://127.0.0.1:8811/oven.html in a browser and, once the title says
#    the models are baked, send them to the collector from the console:
#      window.__horneado.reduce((p,s)=>p.then(()=>fetch('http://127.0.0.1:8812/',
#        {method:'POST',body:JSON.stringify(s)})), Promise.resolve())
```

They land in `city/web/assets/sprites/`: one PNG per model and a `medidas.json`
carrying the height, the width, where the ground sits in the image, and how many
pixels one unit measures. With those four numbers Pixi places and scales without
guessing anything.

## Decisions that matter

**Baked in light grey.** The colour comes from Pixi's `tint`, per district, so
one model serves every district instead of baking the same building once per
colour.

**One light and one angle for all of them.** Orthographic at 45° of yaw and
35.26° of pitch — plain old isometric — with the camera looking at the ground and
not at the centre of each building: that way the y=0 plane always falls on the
same pixel and the sprites anchor to the tile. With the camera aimed at each
model's middle, some floated and others sank.

**The framing is fixed, not per model.** Fit each one to its own size and they
come out at different scales on the map, and the city looks like mismatched toys.

**The model is chosen by target height, and then stretched a little.** The first
version picked one of four models by band and left it alone, which meant a house
showed one or two heights across a whole replay: floors landed and nothing moved.
Now the height a parcel's capital asks for is computed first, the closest baked
model is picked for it, and the sprite is stretched the rest of the way — never
by more than about half, so a building still reads as a building. Ties among
models of similar height are broken by hashing the parcel's name, so two parcels
of the same size are not the same silhouette, and the same parcel is always the
same one.
