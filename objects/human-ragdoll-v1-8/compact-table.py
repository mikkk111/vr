#!/usr/bin/env python3
"""Repack the repository's original CC0 GLB: two 512 px maps, original mesh."""
import io,json,pathlib,struct,hashlib,copy
from PIL import Image
here=pathlib.Path(__file__).resolve().parent
src=here.parent/"human-ragdoll-v1-7/assets/table.glb"
data=src.read_bytes()
magic,version,total=struct.unpack_from("<4sII",data)
assert (magic,version,total)==(b"glTF",2,len(data))
chunks={};off=12
while off<len(data):
    n,kind=struct.unpack_from("<I4s",data,off);off+=8;chunks[kind]=data[off:off+n];off+=n
doc=json.loads(chunks[b"JSON"]);oldbin=chunks[b"BIN\0"]
assert len(doc["buffers"])==1
views=doc["bufferViews"];images=doc.get("images",[]);textures=doc.get("textures",[])
keep_tex=set()
for m in doc.get("materials",[]):
    p=m.setdefault("pbrMetallicRoughness",{})
    p.pop("metallicRoughnessTexture",None);p["metallicFactor"]=0;p["roughnessFactor"]=0.84
    for k in ("occlusionTexture","emissiveTexture"):m.pop(k,None)
    for t in (p.get("baseColorTexture"),m.get("normalTexture")):
        if t:keep_tex.add(t["index"])
assert keep_tex, "no colour/normal textures"
keep_images={textures[i]["source"] for i in keep_tex}
assert 1<=len(keep_images)<=2
old_image_views={im["bufferView"] for im in images}
new_image_data={}
for i in sorted(keep_images):
    im=images[i];v=views[im["bufferView"]];off=v.get("byteOffset",0);raw=oldbin[off:off+v["byteLength"]]
    with Image.open(io.BytesIO(raw)) as img:
        img=img.convert("RGB");img.thumbnail((512,512),Image.Resampling.LANCZOS)
        stream=io.BytesIO();img.save(stream,format="JPEG",quality=91,subsampling=0,optimize=True)
        new_image_data[im["bufferView"]]=stream.getvalue()
    im["mimeType"]="image/jpeg"
tex_map={v:i for i,v in enumerate(sorted(keep_tex))}
im_map={v:i for i,v in enumerate(sorted(keep_images))}
doc["images"]=[images[i] for i in sorted(keep_images)]
doc["textures"]=[textures[i] for i in sorted(keep_tex)]
for t in doc["textures"]:t["source"]=im_map[t["source"]]
for m in doc.get("materials",[]):
    for t in (m["pbrMetallicRoughness"].get("baseColorTexture"),m.get("normalTexture")):
        if t:t["index"]=tex_map[t["index"]]
blob=bytearray()
for i,v in enumerate(views):
    off=v.get("byteOffset",0)
    raw=new_image_data.get(i,b"\0" if i in old_image_views else oldbin[off:off+v["byteLength"]])
    while len(blob)%4:blob.append(0)
    v["byteOffset"]=len(blob);v["byteLength"]=len(raw);blob.extend(raw)
while len(blob)%4:blob.append(0)
doc["buffers"]=[{"byteLength":len(blob)}]
doc["asset"].pop("extras",None)
doc["asset"]["extras"]={"source":"https://polyhaven.com/a/painted_wooden_table","license":"CC0-1.0","textureResolution":512}
j=json.dumps(doc,separators=(",",":")).encode();j+=b" "*((-len(j))%4)
out=struct.pack("<4sII",b"glTF",2,12+8+len(j)+8+len(blob))+struct.pack("<I4s",len(j),b"JSON")+j+struct.pack("<I4s",len(blob),b"BIN\0")+blob
assert len(out)<len(data)*.25, "asset did not shrink sufficiently"
triangles=sum(doc["accessors"][p["indices"]]["count"]//3 if "indices" in p else doc["accessors"][p["attributes"]["POSITION"]]["count"]//3 for m in doc["meshes"] for p in m["primitives"] if p.get("mode",4)==4)
assert triangles==600
assets=here/"assets";assets.mkdir(exist_ok=True)
(assets/"table-lite.glb").write_bytes(out)
report={"bytes":len(out),"originalBytes":len(data),"sha256":hashlib.sha256(out).hexdigest(),"triangles":triangles,"images":len(doc["images"]),"maxTexturePixels":512,"license":"CC0-1.0"}
(assets/"table-lite.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report))
