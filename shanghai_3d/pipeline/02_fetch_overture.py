"""Fetch Overture Maps buildings / building parts / places for the Shanghai bbox.

usage: 02_fetch_overture.py <out_dir> [release]
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duckdb
from common import BBOX_LL

out = sys.argv[1]
REL = sys.argv[2] if len(sys.argv) > 2 else "2026-10-21.0"
W, S, E, N = BBOX_LL
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
con.execute("SET s3_region='us-west-2'; SET http_timeout=600000; SET http_retries=8;")
base = f"s3://overturemaps-us-west-2/release/{REL}"
box = f"bbox.xmax >= {W} AND bbox.xmin <= {E} AND bbox.ymax >= {S} AND bbox.ymin <= {N}"
jobs = {
    "buildings": f"""SELECT id, ST_AsWKB(geometry) AS wkb, sources[1].dataset AS src, sources[1].record_id AS src_id, names.primary AS name, class, subtype,
                            height, num_floors, min_height, min_floor, roof_shape, roof_height, roof_color, facade_color, facade_material, roof_material, has_parts,
                            bbox.xmin AS xmin, bbox.ymin AS ymin, bbox.xmax AS xmax, bbox.ymax AS ymax
                     FROM read_parquet('{base}/theme=buildings/type=building/*') WHERE {box}""",
    "building_parts": f"""SELECT id, building_id, ST_AsWKB(geometry) AS wkb, names.primary AS name, height, num_floors, min_height, min_floor, roof_shape, roof_height, roof_color,
                                 facade_color, facade_material, roof_material, bbox.xmin AS xmin, bbox.ymin AS ymin, bbox.xmax AS xmax, bbox.ymax AS ymax
                          FROM read_parquet('{base}/theme=buildings/type=building_part/*') WHERE {box}""",
    "places": f"""SELECT id, ST_X(geometry) AS lon, ST_Y(geometry) AS lat, names.primary AS name, to_json(names.common) AS names_common, basic_category AS category,
                         taxonomy.primary AS taxonomy, to_json(taxonomy.hierarchy) AS hierarchy, operating_status, confidence, brand.names.primary AS brand, sources[1].dataset AS src, addresses[1].freeform AS address
                  FROM read_parquet('{base}/theme=places/type=place/*') WHERE {box}""",
}
for name, q in jobs.items():
    dst = os.path.join(out, name + ".parquet")
    if os.path.exists(dst):
        print(name, "exists"); continue
    t = time.time()
    try:
        con.execute(f"COPY ({q}) TO '{dst}.tmp' (FORMAT PARQUET, COMPRESSION ZSTD)")
        os.replace(dst + ".tmp", dst)
        print(name, con.execute(f"SELECT count(*) FROM read_parquet('{dst}')").fetchone()[0], "rows in", round(time.time() - t, 1), "s", flush=True)
    except Exception as e:
        print("ERR", name, repr(e)[:400], flush=True)
