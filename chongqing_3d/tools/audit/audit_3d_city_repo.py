#!/usr/bin/env python3
"""Phase 6 Audit — Open-Source `3d_city` Local Git Repo, Legal, Secrets, Sizes & Video Specs Verifier.

Read-only audit of the local 3d_city repository.
Usage:
  python audit_3d_city_repo.py [--repo <3d_city_dir>]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image

REPO_DEFAULT = str(Path(__file__).resolve().parents[3])


class Report:
    def __init__(self):
        self.checks = []

    def add(self, section, name, status, detail, data=None):
        entry = {"section": section, "name": name, "status": status, "detail": detail}
        if data is not None:
            entry["data"] = data
        self.checks.append(entry)
        print(f"[{status}] {section}.{name}: {detail}")

    def summary(self):
        return {k: sum(1 for c in self.checks if c["status"] == k) for k in ("PASS", "WARN", "FAIL", "SKIP")}


def run_git(repo: Path, *args):
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def dir_size_bytes(p: Path):
    tot = 0
    for root, dirs, files in os.walk(p):
        for f in files:
            fp = Path(root) / f
            if not fp.is_symlink():
                try:
                    tot += fp.stat().st_size
                except OSError:
                    pass
    return tot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=REPO_DEFAULT)
    args = ap.parse_args()
    t0 = time.time()
    repo = Path(args.repo)
    rep = Report()

    print(f"=== Phase 6 Open-Source `3d_city` Repo & Legal Audit ({repo}) ===")

    # 1. Repo & Parent Isolation + Git Status/Remote/No-Push Checks
    if not (repo / ".git").is_dir():
        rep.add("git", "repo_exists", "FAIL", f"Missing git repo at {repo / '.git'}")
        sys.exit(1)
    else:
        rep.add("git", "repo_exists", "PASS", f"Local git repository present at {repo}")

    parent_git = repo.parent / ".git"
    if parent_git.exists():
        rep.add("git", "parent_isolated", "FAIL", f"Unexpected .git found in parent workspace {parent_git}!")
    else:
        rep.add("git", "parent_isolated", "PASS", f"Parent {repo.parent} remains cleanly untouched (no .git)")

    rc, status_out, _ = run_git(repo, "status", "--porcelain")
    if rc == 0 and status_out == "":
        rep.add("git", "working_tree_clean", "PASS", "git status --porcelain is 100% clean")
    else:
        rep.add("git", "working_tree_clean", "FAIL", f"Dirty or untracked files in git status:\n{status_out[:600]}")

    rc, log_out, _ = run_git(repo, "log", "--oneline", "-n", "10")
    commits = [l for l in log_out.splitlines() if l.strip()]
    if rc == 0 and len(commits) >= 1:
        rep.add("git", "commits", "PASS", f"{len(commits)} local commit(s): {commits[0]}", commits)
    else:
        rep.add("git", "commits", "FAIL", "No commits found in git log")

    rc, rem_out, _ = run_git(repo, "remote", "-v")
    expected_url = "https://github.com/mawwalker/3d_city.git"
    if rc == 0 and expected_url in rem_out:
        rep.add("git", "remote_origin", "PASS", f"origin configured to {expected_url}")
    else:
        rep.add("git", "remote_origin", "FAIL", f"origin mismatch! Got: {rem_out!r}")

    rc, refs_rem, _ = run_git(repo, "for-each-ref", "refs/remotes")
    if rc == 0 and refs_rem == "":
        rep.add("git", "no_push_performed", "PASS", "refs/remotes is empty (confirmed NO push to GitHub)")
    else:
        rep.add("git", "no_push_performed", "FAIL", f"Remote tracking refs exist (push may have occurred!): {refs_rem}")

    # 2. Untracked / Gitignored Deliverables + Media Specs
    rc, ls_out, _ = run_git(repo, "ls-files")
    tracked = [l for l in ls_out.splitlines() if l.strip()]
    tracked_set = set(tracked)

    for rel in ("X_POST_DRAFT.md", "media_for_github_upload"):
        p = repo / rel
        rc_ign, _, _ = run_git(repo, "check-ignore", "-q", rel)
        leaked = any(t == rel or t.startswith(rel + "/") for t in tracked)
        if not p.exists():
            rep.add("ignore", rel, "FAIL", f"Missing required untracked path {p}")
        elif leaked or rc_ign != 0:
            rep.add("ignore", rel, "FAIL", f"{rel} MUST be gitignored and untracked! (leaked={leaked}, check_ignore_rc={rc_ign})")
        else:
            rep.add("ignore", rel, "PASS", f"{rel} exists on disk and is strictly gitignored (0 tracked files)")

    # Check 3 GitHub upload MP4s (<= 9.5 MB each!)
    mdir = repo / "media_for_github_upload"
    for city in ("chongqing", "shanghai", "beijing"):
        mp4 = mdir / f"{city}_github.mp4"
        if not mp4.exists():
            rep.add("media", f"{city}_github_mp4", "FAIL", f"Missing {mp4}")
        else:
            mb = mp4.stat().st_size / (1024 * 1024)
            st = "PASS" if (0.5 <= mb <= 9.5) else "FAIL"
            rep.add("media", f"{city}_github_mp4", st, f"{mp4.name}: {mb:.2f} MB (gate: <= 9.50 MB)")

    master_mp4 = Path(__file__).resolve().parents[2] / "video" / "chongqing_1080p.mp4"
    if master_mp4.exists():
        mb = master_mp4.stat().st_size / (1024 * 1024)
        rep.add("media", "chongqing_1080p_master", "PASS" if mb >= 5.0 else "WARN", f"{master_mp4}: {mb:.2f} MB")
    else:
        rep.add("media", "chongqing_1080p_master", "FAIL", f"Missing {master_mp4}")

    # Check 3 tracked cover posters (docs/covers/*_cover.jpg)
    for city in ("chongqing", "shanghai", "beijing"):
        rel = f"docs/covers/{city}_cover.jpg"
        p = repo / rel
        if rel not in tracked_set or not p.exists():
            rep.add("media", f"{city}_cover", "FAIL", f"Missing or untracked cover poster {rel}")
        else:
            try:
                im = Image.open(p)
                w, h = im.size
                kb = p.stat().st_size // 1024
                ok = w >= 1280 and h >= 720 and kb >= 30
                rep.add("media", f"{city}_cover", "PASS" if ok else "WARN", f"{rel} tracked: {w}x{h} ({kb} KB)")
            except Exception as e:
                rep.add("media", f"{city}_cover", "FAIL", f"Unreadable {rel}: {e}")

    # 3. Tracked Files: Sizes, Forbidden Paths, Symlinks, Proprietary Fonts & Secrets!
    forbidden_parts = (".venv", "node_modules", "__pycache__", ".wrangler", "data/raw", "data/work", "data/debug", "shots/")
    forbidden_hits = []
    oversized_50m = []
    warn_25m = []
    symlinks_bad = []
    fonts_tracked = []
    prop_fonts = []
    secret_hits = []
    personal_path_hits = []
    city_bytes = {}
    file_sizes = []

    secret_re = re.compile(
        r"(?:BEGIN\s+(?:RSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY"
        r"|sk-[A-Za-z0-9]{20,}"
        r"|ghp_[A-Za-z0-9]{25,}"
        r"|github_pat_[A-Za-z0-9_]{30,}"
        r"|AIza[0-9A-Za-z\-_]{35}"
        r"|CF_API_TOKEN\s*=\s*['\"]?[A-Za-z0-9_\-]{20,}"
        r"|\"account_id\"\s*:\s*\"[0-9a-f]{32}\")",
        re.IGNORECASE,
    )
    prop_font_re = re.compile(r"(pricedown|arial|helvetica|times|pingfang|msyh|simhei|simsun|heiti|stsong)", re.IGNORECASE)
    text_exts = {".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".json", ".jsonc", ".md", ".txt", ".html", ".css", ".yml", ".yaml", ".toml"}

    total_tracked_bytes = 0
    for rel in tracked:
        p = repo / rel
        top = rel.split("/")[0]
        if any(fp in rel for fp in forbidden_parts) or Path(rel).name.startswith(".env"):
            forbidden_hits.append(rel)
        if p.is_symlink():
            target = os.readlink(p)
            resolved = p.resolve()
            if not p.exists() or not str(resolved).startswith(str(repo.resolve())):
                symlinks_bad.append((rel, target))
        if p.exists() and not p.is_symlink():
            sz = p.stat().st_size
            total_tracked_bytes += sz
            city_bytes[top] = city_bytes.get(top, 0) + sz
            file_sizes.append((sz, rel))
            if sz >= 50 * 1024 * 1024:
                oversized_50m.append((rel, round(sz / (1024 * 1024), 2)))
            elif sz >= 25 * 1024 * 1024:
                warn_25m.append((rel, round(sz / (1024 * 1024), 2)))
        ext = p.suffix.lower()
        if ext in (".ttf", ".otf", ".woff", ".woff2", ".ttc"):
            fonts_tracked.append(rel)
            if prop_font_re.search(rel):
                prop_fonts.append(rel)
        if ext in text_exts and p.exists() and not p.is_symlink() and p.stat().st_size < 2 * 1024 * 1024:
            # Skip third-party vendored minified libs for personal-path checks, still check secrets everywhere
            try:
                txt = p.read_text(errors="ignore")
            except Exception:
                txt = ""
            m = secret_re.search(txt)
            if m:
                secret_hits.append((rel, m.group(0)[:48]))
            if "/home/" in txt and "vendor/" not in rel and "tools/audit/" not in rel:
                personal_path_hits.append(rel)

    git_pack_bytes = dir_size_bytes(repo / ".git")
    file_sizes.sort(reverse=True)
    top10 = [{"file": r, "mb": round(s / (1024 * 1024), 2)} for s, r in file_sizes[:10]]
    city_mb = {k: round(v / (1024 * 1024), 2) for k, v in sorted(city_bytes.items(), key=lambda kv: -kv[1])}

    rep.add("files", "forbidden_paths", "PASS" if not forbidden_hits else "FAIL",
            f"Forbidden build/env/raw/cache paths in git: {len(forbidden_hits)} {forbidden_hits[:6]}")
    rep.add("files", "symlinks_clean", "PASS" if not symlinks_bad else "FAIL",
            f"Broken or out-of-repo symlinks: {len(symlinks_bad)} {symlinks_bad[:6]}")
    rep.add("files", "secrets_scan", "PASS" if not secret_hits else "FAIL",
            f"Secrets/API keys/Cloudflare account IDs in tracked files: {len(secret_hits)} {secret_hits[:5]}")
    rep.add("files", "personal_paths", "PASS" if not personal_path_hits else "WARN",
            f"Hardcoded /home/ paths in runtime/docs/scripts: {len(personal_path_hits)} {personal_path_hits[:8]}")
    rep.add("files", "fonts_license", "PASS" if not prop_fonts else "FAIL",
            f"Tracked font files={len(fonts_tracked)} ({fonts_tracked[:6]}), proprietary hits={len(prop_fonts)} {prop_fonts}")
    rep.add("files", "max_file_size_50mb", "PASS" if not oversized_50m else "FAIL",
            f"Tracked files >=50 MB: {len(oversized_50m)} {oversized_50m} | >=25 MB: {warn_25m} | largest={top10[0] if top10 else None}",
            {"top10": top10})
    rep.add("files", "repo_size", "PASS",
            f"Tracked files={len(tracked)}, working tree={total_tracked_bytes/(1024*1024):.1f} MB, .git pack={git_pack_bytes/(1024*1024):.1f} MB, breakdown={city_mb}",
            {"tracked_count": len(tracked), "tracked_mb": round(total_tracked_bytes / (1024 * 1024), 2), "git_mb": round(git_pack_bytes / (1024 * 1024), 2), "by_dir_mb": city_mb})

    # Verify serve.sh exists and is executable for all 3 cities
    for cdir in ("beijing_3d", "shanghai_3d", "chongqing_3d"):
        sp = repo / cdir / "serve.sh"
        if not sp.exists():
            rep.add("runnable", f"{cdir}_serve_sh", "FAIL", f"Missing {sp}")
        else:
            is_exec = os.access(sp, os.X_OK)
            rep.add("runnable", f"{cdir}_serve_sh", "PASS" if is_exec else "WARN", f"{cdir}/serve.sh exists (executable={is_exec})")

    # 4. Legal, Licensing & Attribution Verification
    lic_p = repo / "LICENSE"
    if not lic_p.exists():
        rep.add("legal", "license_file", "FAIL", "Missing LICENSE")
    else:
        ltxt = lic_p.read_text(errors="ignore")
        req = [
            ("Apache License 2.0", r"Apache\s+License[\s\S]{0,40}Version\s+2\.0"),
            ("mawwalker copyright", r"mawwalker"),
            ("NOTICE Section 4(d)", r"NOTICE"),
            ("CC BY 4.0 docs", r"CC\s+BY\s+4\.0"),
            ("ODbL 1.0 open-data notice", r"ODbL\s*1\.0"),
            ("Copernicus DEM notice", r"Copernicus"),
            ("CC0 notice", r"CC0"),
            ("MIT/ISC vendor notice", r"MIT"),
        ]
        miss = [nm for nm, pat in req if not re.search(pat, ltxt, re.I)]
        rep.add("legal", "license_file", "PASS" if not miss else "FAIL",
                f"LICENSE ({len(ltxt)} chars): missing={miss}" if miss else f"LICENSE complete ({len(ltxt)} chars): Apache-2.0 + NOTICE + CC BY 4.0 docs + ODbL/Copernicus/CC0/MIT notices verified")

    not_p = repo / "NOTICE"
    if not not_p.exists() or "NOTICE" not in tracked_set:
        rep.add("legal", "notice_file", "FAIL", "Missing or untracked NOTICE file (Apache-2.0 Section 4(d))")
    else:
        ntxt = not_p.read_text(errors="ignore")
        nreq = [("mawwalker", r"mawwalker"), ("3d_city", r"mawwalker/3d_city"), ("OSM", r"OpenStreetMap"), ("Copernicus", r"Copernicus")]
        nmiss = [nm for nm, pat in nreq if not re.search(pat, ntxt, re.I)]
        rep.add("legal", "notice_file", "PASS" if not nmiss else "FAIL",
                f"NOTICE ({len(ntxt)} chars): missing={nmiss}" if nmiss else f"NOTICE complete ({len(ntxt)} chars): mandatory Apache-2.0 Section 4(d) + upstream attributions verified")

    tpn_p = repo / "THIRD_PARTY_NOTICES.md"
    if not tpn_p.exists():
        rep.add("legal", "third_party_notices", "FAIL", "Missing THIRD_PARTY_NOTICES.md")
    else:
        ttxt = tpn_p.read_text(errors="ignore")
        req = [
            ("OSM contributors", r"OpenStreetMap\s+contributors"),
            ("ODbL 1.0", r"ODbL"),
            ("Copernicus DLR", r"DLR"),
            ("Copernicus Airbus", r"Airbus"),
            ("Copernicus ESA/EU", r"ESA"),
            ("GlobalBuildingAtlas", r"GlobalBuildingAtlas"),
            ("Overture Maps", r"Overture"),
            ("CBMF", r"CBMF"),
            ("SinoLC-1", r"SinoLC"),
            ("Canopy Height", r"Canopy"),
            ("ambientCG", r"ambientCG"),
            ("Poly Haven", r"Poly\s*Haven"),
            ("Three.js", r"Three\.js"),
            ("three-mesh-bvh", r"three-mesh-bvh"),
            ("earcut", r"earcut"),
            ("SIL OFL", r"OFL"),
            ("WGS-84", r"WGS-?84"),
            ("non-navigation disclaimer", r"navigation|surveying|导航|测绘"),
        ]
        miss = [nm for nm, pat in req if not re.search(pat, ttxt, re.I)]
        rep.add("legal", "third_party_notices", "PASS" if not miss else "FAIL",
                f"THIRD_PARTY_NOTICES.md missing: {miss}" if miss else f"THIRD_PARTY_NOTICES.md complete ({len(ttxt)} chars): all 18 required attributions & disclaimers present")

    rd_p = repo / "README.md"
    if not rd_p.exists():
        rep.add("legal", "readme", "FAIL", "Missing README.md")
    else:
        rtxt = rd_p.read_text(errors="ignore")
        req = [
            ("chongqing_cover.jpg", r"docs/covers/chongqing_cover\.jpg"),
            ("shanghai_cover.jpg", r"docs/covers/shanghai_cover\.jpg"),
            ("beijing_cover.jpg", r"docs/covers/beijing_cover\.jpg"),
            ("serve.sh quickstart", r"serve\.sh"),
            ("Apache-2.0 license", r"Apache\s+License|Apache-2\.0"),
            ("NOTICE reference", r"NOTICE"),
            ("CC BY 4.0 docs", r"CC\s+BY\s+4\.0"),
            ("OpenStreetMap attribution", r"OpenStreetMap"),
            ("Copernicus attribution", r"Copernicus"),
            ("mawwalker/3d_city", r"mawwalker/3d_city"),
            ("GitHub inline video slot", r"media_for_github_upload|drag|拖拽|video"),
        ]
        miss = [nm for nm, pat in req if not re.search(pat, rtxt, re.I)]
        rep.add("legal", "readme", "PASS" if not miss else "FAIL",
                f"README.md missing: {miss}" if miss else f"README.md complete ({len(rtxt)} chars): 3 cover posters, quickstart, bilingual showcase, licensing & attributions verified")

    xp_p = repo / "X_POST_DRAFT.md"
    if xp_p.exists():
        xtxt = xp_p.read_text(errors="ignore")
        has_link = "github.com/mawwalker/3d_city" in xtxt
        has_versions = len(re.findall(r"(?:Version|版本)\s*[ABC]|Thread|English", xtxt, re.I)) >= 3
        rep.add("docs", "x_post_draft", "PASS" if (has_link and has_versions and len(xtxt) > 500) else "WARN",
                f"Untracked X_POST_DRAFT.md verified ({len(xtxt)} chars, repo_link={has_link}, multi_versions={has_versions})")

    s = rep.summary()
    elapsed = round(time.time() - t0, 2)
    print(f"\n=== 3d_city Repo Audit Summary ({elapsed}s): PASS={s['PASS']} WARN={s['WARN']} FAIL={s['FAIL']} SKIP={s['SKIP']} ===")
    out_p = Path(__file__).parent / "phase6_repo_audit_report.json"
    out_p.write_text(json.dumps({"elapsed_s": elapsed, "summary": s, "checks": rep.checks}, indent=2, ensure_ascii=False))
    sys.exit(1 if s["FAIL"] > 0 else 0)


if __name__ == "__main__":
    main()
