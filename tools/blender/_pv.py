exec(open("D:/Web Based - Horror Game/tools/blender/lib.py").read())
result = {"a": preview('widow_baked_face.png', target=(0, 0, 1.9), cam=(0.25, -0.7, 1.95), lens=55, res=(720, 720), hide=('Widow_Veil', 'Widow_Hair')),
          "b": preview('widow_baked_full.png', target=(0, 0, 1.3), cam=(0.9, -3.2, 1.7), lens=42, engine='CYCLES')}
