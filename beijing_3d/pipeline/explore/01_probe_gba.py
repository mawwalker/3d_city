"""Probe GlobalBuildingAtlas LoD1 GeoParquet on Source Cooperative for the Beijing bbox."""
import sys, time
import duckdb

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
con.execute("SET s3_region='us-west-2'; SET s3_endpoint='s3.us-west-2.amazonaws.com';")
base = "s3://us-west-2.opendata.source.coop/tge-labs/globalbuildingatlas-lod1"
f = f"{base}/e115_n40_e120_n35.parquet"
t = time.time()
print(con.execute(f"DESCRIBE SELECT * FROM read_parquet('{f}')").fetchall())
md = con.execute(f"SELECT count(*) AS n_rg, sum(row_group_num_rows) FROM (SELECT DISTINCT row_group_id, row_group_num_rows FROM parquet_metadata('{f}'))").fetchall()
print("row groups / rows", md, time.time() - t)
print(con.execute(f"SELECT path_in_schema, min(stats_min), max(stats_max), sum(total_compressed_size)/1e6 FROM parquet_metadata('{f}') GROUP BY 1").fetchall())
kv = con.execute(f"SELECT key, value FROM parquet_kv_metadata('{f}')").fetchall()
for k, v in kv:
    print(k, str(v)[:600])
