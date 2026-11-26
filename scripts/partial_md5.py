#!/usr/bin/env python3
"""Reference port of KOReader's util.partialMD5 (frontend/util.lua), used to check Trove's Rust version."""
import hashlib
import sys


def partial_md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for i in range(-1, 11):
            # LuaJIT: bit.lshift(1024, -2) wraps the shift count to 30 and overflows to 0
            offset = 0 if i < 0 else 1024 << (2 * i)
            f.seek(offset)
            sample = f.read(1024)
            if not sample:
                break
            h.update(sample)
    return h.hexdigest()


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(partial_md5(p), p)
