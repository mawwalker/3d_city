"""Fetch GlobalBuildingAtlas LoD1 buildings for the greater-Beijing bbox into a local parquet."""
import sys, time
import duckdb

out = sys.argv[1]
W, S, E, N = 116.02, 39.60, 116.78, 40.22
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
con.execute("SET s3_region='us-west-2'; SET s3_endpoint='s3.us-west-2.amazonaws.com'; SET http_timeout=600000; SET http_retries=8;")
base = "s3://us-west-2.opendata.source.coop/tge-labs/globalbuildingatlas-lod1"
files = [f"{base}/e115_n40_e120_n35.parquet", f"{base}/e115_n45_e120_n40.parquet"]
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
