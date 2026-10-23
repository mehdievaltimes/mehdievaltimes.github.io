"""Look at candidate small chat models in ONNX form: which files exist, how big, and how the
residual stream around a middle layer is wired, so the steering input can be spliced in."""
import collections, sys
from huggingface_hub import HfApi, hf_hub_download
import onnx

api = HfApi()
for repo in ["onnx-community/Qwen2.5-0.5B-Instruct", "HuggingFaceTB/SmolLM2-360M-Instruct", "onnx-community/SmolLM2-360M-Instruct"]:
    try:
        info = api.model_info(repo, files_metadata=True)
    except Exception as e:
        print(f"\n## {repo}: {e}")
        continue
    print(f"\n## {repo}")
    for s in sorted(info.siblings, key=lambda s: s.rfilename):
        if s.rfilename.startswith("onnx/") or s.rfilename.endswith(".json"):
            print(f"  {s.rfilename:48s} {(s.size or 0) / 1e6:9.1f} MB")

repo, fname = sys.argv[1], sys.argv[2]
path = hf_hub_download(repo, fname)
m = onnx.load(path, load_external_data=False)
g = m.graph
print(f"\n## graph {repo}/{fname}")
print("inputs:", [(i.name, [d.dim_param or d.dim_value for d in i.type.tensor_type.shape.dim]) for i in g.input][:6], "...", len(g.input), "total")
print("outputs:", [o.name for o in g.output][:4], "...", len(g.output), "total")
print("op counts:", collections.Counter(n.op_type for n in g.node).most_common(15))
print("external data initializers:", sum(1 for t in g.initializer if t.data_location == onnx.TensorProto.EXTERNAL))
layer = sys.argv[3]
print(f"\n## nodes mentioning layers.{layer}/ and layers.{int(layer) + 1}/ (first 40 each)")
for L in (layer, str(int(layer) + 1)):
    hits = [n for n in g.node if f"layers.{L}/" in n.name]
    for n in hits[:40]:
        print(f"  {n.op_type:34s} {n.name:60s} in={list(n.input)[:3]} out={list(n.output)[:4]}")
