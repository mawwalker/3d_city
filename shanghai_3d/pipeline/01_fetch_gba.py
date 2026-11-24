"""Fetch GlobalBuildingAtlas LoD1 buildings for the greater-Shanghai bbox into a local parquet.

usage: 01_fetch_gba.py <out.parquet>
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import duckdb
from common import BBOX_LL

out = sys.argv[1]
W, S, E, N = BBOX_LL
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
con.execute("SET s3_region='us-west-2'; SET s3_endpoint='s3.us-west-2.amazonaws.com'; SET http_timeout=600000; SET http_retries=8;")
base = "s3://us-west-2.opendata.source.coop/tge-labs/globalbuildingatlas-lod1"
files = [f"{base}/e120_n35_e125_n30.parquet"]
t = time.time()
q = f"""
COPY (
  SELECT source, id, height, var, ST_AsWKB(geometry) AS wkb,
         bbox.xmin AS xmin, bbox.ymin AS ymin, bbox.xmax AS xmax, bbox.ymax AS ymax
  FROM read_parquet({files!r})
  WHERE bbox.xmax >= {W} AND bbox.xmin <= {E} AND bbox.ymax >= {S} AND bbox.ymin <= {N}
) TO '{out}' (FORMAT PARQUET, COMPRESSION ZSTD)
"""
con.execute(q)
print("done", time.time() - t)
print(con.execute(f"SELECT count(*), min(height), avg(height), max(height), sum(CASE WHEN height<0 THEN 1 ELSE 0 END) FROM read_parquet('{out}')").fetchall())
print(con.execute(f"SELECT source, count(*), avg(height), max(height) FROM read_parquet('{out}') GROUP BY 1 ORDER BY 2 DESC").fetchall())
