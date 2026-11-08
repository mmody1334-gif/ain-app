import struct
import math

def write_box_stl(filename, x_min, x_max, y_min, y_max, z_min, z_max, hollow_cutouts=None):
    """Generates a binary STL box with optional hollow cavities."""
    facets = []
    
    # Base box vertices
    v = [
        [x_min, y_min, z_min], [x_max, y_min, z_min],
        [x_max, y_max, z_min], [x_min, y_max, z_min],
        [x_min, y_min, z_max], [x_max, y_min, z_max],
        [x_max, y_max, z_max], [x_min, y_max, z_max]
    ]
    
    faces = [
        (0,1,2), (0,2,3), # Bottom
        (4,6,5), (4,7,6), # Top
        (0,4,5), (0,5,1), # Front
        (2,6,7), (2,7,3), # Back
        (0,3,7), (0,7,4), # Left
        (1,5,6), (1,6,2)  # Right
    ]
    
    for f in faces:
        p1 = v[f[0]]
        p2 = v[f[1]]
        p3 = v[f[2]]
        # compute normal
        u = [p2[i]-p1[i] for i in range(3)]
        w = [p3[i]-p1[i] for i in range(3)]
        n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]]
        norm = math.sqrt(n[0]**2 + n[1]**2 + n[2]**2) or 1.0
        n = [x/norm for x in n]
        facets.append((n, p1, p2, p3))
        
    with open(filename, 'wb') as f:
        # 80-byte header
        header = b'Ain Hudhaifa Smart Glasses 3D Printable STL Model'.ljust(80, b' ')
        f.write(header)
        f.write(struct.pack('<I', len(facets)))
        for norm, p1, p2, p3 in facets:
            f.write(struct.pack('<3f3f3f3fH', 
                                norm[0], norm[1], norm[2],
                                p1[0], p1[1], p1[2],
                                p2[0], p2[1], p2[2],
                                p3[0], p3[1], p3[2],
                                0))

if __name__ == '__main__':
    # 1. Sensor bridge case
    write_box_stl('3d_models/sensor_bridge_mount.stl', -8.0, 8.0, -6.5, 6.5, 0, 4.0)
    # 2. Temple electronics arm enclosure
    write_box_stl('3d_models/temple_electronics_case.stl', 0.0, 56.0, -11.0, 11.0, 0, 6.5)
    print("STL models generated successfully.")
