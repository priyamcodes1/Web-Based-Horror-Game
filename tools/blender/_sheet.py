import bpy, os, numpy as np
D = r"D:\Web Based - Horror Game\public\textures"
names = sorted(f for f in os.listdir(D) if f.endswith('_c.webp'))
T = 192; cols = 6; rows = (len(names) + cols - 1) // cols
sheet = np.zeros((rows * T, cols * T, 4), np.float32); sheet[..., 3] = 1
for i, n in enumerate(names):
    img = bpy.data.images.load(os.path.join(D, n))
    w, h = img.size
    px = np.array(img.pixels[:], np.float32).reshape(h, w, 4)
    sy, sx = max(h // T, 1), max(w // T, 1)
    small = px[::sy, ::sx][:T, :T]
    r, c = rows - 1 - i // cols, i % cols
    sheet[r * T:r * T + small.shape[0], c * T:c * T + small.shape[1]] = small
    bpy.data.images.remove(img)
out = bpy.data.images.new('sheet', cols * T, rows * T)
out.pixels.foreach_set(sheet.ravel())
p = r"D:\Web Based - Horror Game\tools\blender\_preview\tex_sheet.png"
out.filepath_raw = p; out.file_format = 'PNG'; out.save()
result = {"n": names}
