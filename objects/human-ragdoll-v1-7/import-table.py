#!/usr/bin/env python3
"""Download the official CC0 glTF and embed every texture/buffer in one GLB."""
import hashlib,json,mimetypes,struct,urllib.request,urllib.parse,pathlib
ASSET="painted_wooden_table"
OUT=pathlib.Path(__file__).resolve().parent/"assets"
HEADERS={"User-Agent":"VR-Objects-Table-Importer/1.0 (https://github.com/mikkk111/vr)"}
def download(url):
    if urllib.parse.urlparse(url).scheme!="https": raise ValueError("Non-HTTPS asset URL")
    with urllib.request.urlopen(urllib.request.Request(url,headers=HEADERS),timeout=90) as r:
        return r.read()
def get(entry):
    data=download(entry["url"])
    if entry.get("size") and int(entry["size"])!=len(data): raise ValueError("size mismatch "+entry["url"])
    if entry.get("md5") and hashlib.md5(data).hexdigest()!=entry["md5"].lower(): raise ValueError("MD5 mismatch "+entry["url"])
    return data
meta=json.loads(download("https://api.polyhaven.com/files/"+ASSET))
entry=meta["gltf"]["2k"]["gltf"]
doc=json.loads(get(entry))
includes=entry.get("include",{})
def dependency(uri):
    if uri.startswith("data:"):
        import base64
        return base64.b64decode(uri.split(",",1)[1])
    if uri in includes: return get(includes[uri])
    decoded=urllib.parse.unquote(uri)
    if decoded in includes: return get(includes[decoded])
    raise ValueError("URI missing from official include metadata: "+uri)
blob=bytearray()
def append(data):
    while len(blob)%4:blob.append(0)
    off=len(blob);blob.extend(data);return off
offsets=[]
for b in doc["buffers"]:
    raw=dependency(b["uri"])
    if len(raw)<b["byteLength"]:raise ValueError("truncated buffer")
    offsets.append(append(raw[:b["byteLength"]]))
for view in doc.get("bufferViews",[]):
    view["byteOffset"]=view.get("byteOffset",0)+offsets[view.get("buffer",0)]
    view["buffer"]=0
for img in doc.get("images",[]):
    if "uri" not in img:continue
    uri=img.pop("uri");raw=dependency(uri)
    mime=("image/png" if raw.startswith(b"\x89PNG") else "image/jpeg" if raw.startswith(b"\xff\xd8") else mimetypes.guess_type(uri)[0])
    if mime not in ("image/png","image/jpeg","image/webp"):raise ValueError("unsupported texture "+str(mime))
    off=append(raw);img["bufferView"]=len(doc.setdefault("bufferViews",[]));doc["bufferViews"].append({"buffer":0,"byteOffset":off,"byteLength":len(raw)});img["mimeType"]=mime
while len(blob)%4:blob.append(0)
doc["buffers"]=[{"byteLength":len(blob)}]
doc.setdefault("asset",{}).setdefault("extras",{}).update({"source":"https://polyhaven.com/a/"+ASSET,"author":"Kirill Sannikov","license":"CC0-1.0","resolution":"2k"})
j=json.dumps(doc,separators=(",",":")).encode()
j+=b" "*((-len(j))%4)
glb=struct.pack("<4sII",b"glTF",2,12+8+len(j)+8+len(blob))+struct.pack("<I4s",len(j),b"JSON")+j+struct.pack("<I4s",len(blob),b"BIN\0")+blob
if len(glb)>32*1024*1024:raise ValueError("Asset exceeds Quest download budget")
triangles=sum(doc["accessors"][p["indices"]]["count"]//3 if "indices" in p else doc["accessors"][p["attributes"]["POSITION"]]["count"]//3 for m in doc["meshes"] for p in m["primitives"] if p.get("mode",4)==4)
if not 100<=triangles<=10000:raise ValueError("Unexpected triangle count")
if len(doc.get("images",[]))<2:raise ValueError("Missing PBR textures")
OUT.mkdir(exist_ok=True)
(OUT/"table.glb").write_bytes(glb)
report={"asset":ASSET,"source":"https://polyhaven.com/a/"+ASSET,"author":"Kirill Sannikov","license":"CC0-1.0","resolution":"2k","bytes":len(glb),"sha256":hashlib.sha256(glb).hexdigest(),"triangles":triangles,"images":len(doc["images"]),"materials":len(doc.get("materials",[]))}
(OUT/"table-asset.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))
