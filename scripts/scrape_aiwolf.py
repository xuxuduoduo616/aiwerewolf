#!/usr/bin/env python3
"""
Scrape aiwolf-nlp-viewer logs from GitHub and build role-specific speech libraries.
Output: src/data/{role}_speeches.json
"""

import json, re, time
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import HTTPError

BASE_API = "https://api.github.com/repos/aiwolfdial/aiwolf-nlp-viewer/contents/static/assets"
BASE_RAW = "https://raw.githubusercontent.com/aiwolfdial/aiwolf-nlp-viewer/main/static/assets"

# Folders that have English or mixed-language logs
FOLDERS = [
    "inlg2025_en_truck5",
    "inlg2025_en_truck13",
    "inlg2025_truck5",
    "inlg2025_truck13",
    "jsai2025_truck5",
    "jsai2025_truck13",
    "jsai2026_truck5",
    "jsai2026_truck9",
    "nlp2025",
]

# Map aiwolf roles -> our game roles
ROLE_MAP = {
    "VILLAGER": "villager",
    "WEREWOLF": "werewolf",
    "SEER": "seer",
    "WITCH": "witch",       # not in aiwolf standard but kept
    "HUNTER": "hunter",     # not in aiwolf standard but kept
    "POSSESSED": "possessed",  # aiwolf's traitor/possessed (like wolf ally)
    "BODYGUARD": "bodyguard",
    "MEDIUM": "medium",
    "IDIOT": "idiot",
}

# Tag speeches by context
def tag_speech(text: str, day: int, role: str):
    tags = []
    t = text.lower()
    if day == 0: tags.append("opening")
    if "seer" in t or "divination" in t or "divine" in t: tags.append("seer_related")
    if "werewolf" in t or "wolf" in t: tags.append("wolf_related")
    if "vote" in t: tags.append("voting")
    if "skip" in t.strip() or text.strip().upper() == "SKIP": tags.append("skip")
    if "over" in t.strip() or text.strip().upper() == "OVER": tags.append("over")
    if role == "WEREWOLF" and day > 0: tags.append("wolf_day_speech")
    if role == "SEER": tags.append("seer_speech")
    return tags

def fetch_url(url: str, retries=3):
    for i in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "aiwerewolf-scraper/1.0"})
            with urlopen(req, timeout=10) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except HTTPError as e:
            if e.code == 429:
                time.sleep(2 ** i)
            elif e.code == 404:
                return None
            else:
                time.sleep(1)
        except Exception:
            time.sleep(1)
    return None

def list_logs(folder: str):
    url = f"{BASE_API}/{folder}"
    raw = fetch_url(url)
    if not raw:
        return []
    items = json.loads(raw)
    return [i["name"] for i in items if i["name"].endswith(".log")]

def parse_log(content: str) -> list[dict]:
    """Parse aiwolf log lines. Returns list of speech records."""
    # Build agent->role map from status lines
    agent_role: dict[int, str] = {}
    speeches = []

    for line in content.splitlines():
        parts = line.strip().split(",", 5)
        if len(parts) < 3:
            continue

        day_str = parts[0]
        event = parts[1]

        try:
            day = int(day_str)
        except ValueError:
            continue

        if event == "status" and len(parts) >= 5:
            # format: day,status,agent_id,role,alive_status,...
            try:
                agent_id = int(parts[2])
                role = parts[3].upper()
                agent_role[agent_id] = role
            except (ValueError, IndexError):
                pass

        elif event == "talk" and len(parts) >= 6:
            # format: day,talk,idx,turn,agent_id,text
            try:
                agent_id = int(parts[4])
                text = parts[5].strip()
                if not text or text.upper() in ("SKIP", "OVER"):
                    continue
                if len(text) < 10:
                    continue
                role = agent_role.get(agent_id, "UNKNOWN")
                if role == "UNKNOWN":
                    continue
                tags = tag_speech(text, day, role)
                speeches.append({
                    "text": text,
                    "role": role,
                    "day": day,
                    "tags": tags,
                })
            except (ValueError, IndexError):
                pass

        elif event == "whisper" and len(parts) >= 6:
            # Whisper = wolf night chat (day is actually night round)
            try:
                agent_id = int(parts[4])
                text = parts[5].strip()
                if not text or len(text) < 8:
                    continue
                role = agent_role.get(agent_id, "UNKNOWN")
                speeches.append({
                    "text": text,
                    "role": role,
                    "day": day,
                    "tags": ["wolf_night_chat", "whisper"],
                })
            except (ValueError, IndexError):
                pass

    return speeches

def run():
    out_dir = Path(__file__).parent.parent / "src" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    by_role: dict[str, list[dict]] = defaultdict(list)
    total_games = 0
    total_speeches = 0

    for folder in FOLDERS:
        print(f"\n📁 {folder}")
        logs = list_logs(folder)
        print(f"   {len(logs)} games found")

        for log_name in logs[:20]:  # cap at 20 per folder to avoid API limits
            url = f"{BASE_RAW}/{folder}/{log_name}"
            content = fetch_url(url)
            if not content:
                print(f"   ⚠ skip {log_name}")
                continue

            speeches = parse_log(content)
            for s in speeches:
                role = s["role"]
                by_role[role].append(s)

            total_games += 1
            total_speeches += len(speeches)
            print(f"   ✓ {log_name}: {len(speeches)} speeches")
            time.sleep(0.1)  # be polite to GitHub

    print(f"\n✅ Total: {total_games} games, {total_speeches} speeches")
    print(f"   Roles found: {list(by_role.keys())}")

    # Save by role
    for role, entries in by_role.items():
        role_lower = ROLE_MAP.get(role, role.lower())
        out_path = out_dir / f"{role_lower}_speeches.json"
        # Deduplicate by text
        seen: set[str] = set()
        unique = []
        for e in entries:
            key = e["text"][:100]
            if key not in seen:
                seen.add(key)
                unique.append(e)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(unique, f, ensure_ascii=False, indent=2)
        print(f"   💾 {out_path.name}: {len(unique)} unique speeches")

    # Create a combined summary for quick access
    summary = {
        role: len(entries)
        for role, entries in by_role.items()
    }
    with open(out_dir / "library_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    print("\n✅ Done. Library summary:", summary)

if __name__ == "__main__":
    run()
