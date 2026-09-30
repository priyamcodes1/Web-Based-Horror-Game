import bpy
res = {}
for o in bpy.data.objects:
    if o.type == 'MESH':
        res[o.name] = [round(x, 3) for x in o.dimensions] + [len(o.data.vertices)]
result = res
