exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
car = bpy.data.objects['Car']
hide = tuple(o.name for o in bpy.data.objects if o.type == 'MESH' and o.parent != car)
result = {"p": preview('car.png', target=(0, 0, 0.8), cam=(-5.5, -4.5, 2.2), lens=40, res=(1000, 640), world=0.15, hide=hide)}
