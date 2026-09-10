#!/usr/bin/env python3
"""
幫每一個章節檔案裡的 <h3> 小節補上穩定的錨點 id(給收藏功能用)。

- 只補「還沒有 id」的 <h3>,已經有 id 的完全不動——可以放心重複執行。
- id 用 sha1(相對路徑 + 第幾個 h3 + 標題文字) 取前 6 碼 16 進位,格式 s-xxxxxx。
  一旦寫進檔案就固定下來,除非你自己手動改標題文字(那本來就代表內容變了,
  收藏功能會用「內容已異動」的方式提示,而不是靜默失效)。
- 全站範圍內做碰撞檢查,萬一撞到(機率極低)就自動加長 hash 直到不撞。

用法:python3 scripts/add_h3_ids.py            # 實際寫入
     python3 scripts/add_h3_ids.py --check    # 只檢查,不寫入,回報有幾個缺 id
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

# 只比對「開頭是 <h3>,沒有任何屬性」的乾淨標籤——這是目前全站唯一的寫法。
# 如果之後有人手寫了帶屬性的 <h3 class="...">,這支 script 會直接跳過該檔案
# 該行並印警告,而不是猜測著去改,避免弄壞既有標記。
H3_PLAIN = re.compile(r"<h3>(.*?)</h3>", re.S)
H3_ANY_OPEN = re.compile(r"<h3\b[^>]*>")


def strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s).strip()


def make_id(rel_path: str, index: int, text: str, taken: set) -> str:
    base = f"{rel_path}|{index}|{text}".encode("utf-8")
    length = 6
    while True:
        digest = hashlib.sha1(base).hexdigest()[:length]
        candidate = f"s-{digest}"
        if candidate not in taken:
            return candidate
        length += 2  # 極端罕見的碰撞:加長 hash 重試


def process_file(path: Path, taken: set, check_only: bool):
    rel = str(path.relative_to(ROOT))
    text = path.read_text(encoding="utf-8")

    # 先確認這個檔案裡的 <h3 都是乾淨的(沒屬性)或已經帶 id,否則跳過並警告
    for m in H3_ANY_OPEN.finditer(text):
        tag = m.group(0)
        if tag == "<h3>" or 'id="' in tag:
            continue
        print(f"⚠️  {rel}: 發現非預期的 <h3> 標籤 ({tag}),跳過此檔案,請手動處理")
        return 0

    count_missing = [0]

    def repl(m):
        inner = m.group(1)
        idx = count_missing[0]
        count_missing[0] += 1
        heading_text = strip_tags(inner)
        new_id = make_id(rel, idx, heading_text, taken)
        taken.add(new_id)
        return f'<h3 id="{new_id}">{inner}</h3>'

    new_text = H3_PLAIN.sub(repl, text)
    n = count_missing[0]
    if n and not check_only:
        path.write_text(new_text, encoding="utf-8")
    return n


def collect_existing_ids() -> set:
    taken = set()
    for f in sorted(CONTENT.glob("*/chapters/*.html")):
        for m in re.finditer(r'<h3\s+id="([^"]+)"', f.read_text(encoding="utf-8")):
            taken.add(m.group(1))
    return taken


def main():
    check_only = "--check" in sys.argv
    taken = collect_existing_ids()
    total = 0
    files_touched = 0
    for f in sorted(CONTENT.glob("*/chapters/*.html")):
        n = process_file(f, taken, check_only)
        if n:
            total += n
            files_touched += 1
    verb = "需要補上" if check_only else "補上了"
    print(f"{verb} {total} 個 h3 id,共 {files_touched} 個檔案。")


if __name__ == "__main__":
    main()
