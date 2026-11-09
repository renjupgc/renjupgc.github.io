#!/usr/bin/env python3
"""把 wasm-bindgen 打出来的双表 quintet 模块改成单表。

@renju-note/quintet 的 wasm 里有两张表：

    table 0  funcref    28  → 真正的函数表
    table 1  externref  1024 → wasm-bindgen 给 JS 值（undefined/null/true/false）留的

第二种表是 reference types 提案才有的东西。部分设备的引擎只允许一张表，编译就直接失败：

    WebAssembly.instantiate(): table count of 2 exceeds internal limit of 1

quintet 的导出（solve / solve_vcf / solve_vct / encode_xy …）全是 i32 与 TypedArray，
类型段里没有 externref，指令里也没有 table.get/set/grow —— 那张表纯属闲置。
所以这里把它从 table 段摘掉、连带删掉 `__wbindgen_externrefs` 导出，
模块就退回到只有一张 funcref 表的 MVP 形态。

配套改动：assets/quintet/quintet_bg.js 里的 `__wbindgen_init_externref_table`
改成空函数（wasm 仍会调用这个 import，但已无表可写）。

用法（重新从 npm 拉包之后跑一遍即可）：

    python tools/patch_quintet_wasm.py assets/quintet/quintet_bg.wasm

原地改写；改完用 node 跑一局 VCF 自检，再提交。
"""
import sys

# 原地改写时先读进内存，最后统一写回
PATH = sys.argv[1] if len(sys.argv) > 1 else 'assets/quintet/quintet_bg.wasm'
d = open(PATH, 'rb').read()


def u32(buf, i):
    r = 0; s = 0
    while True:
        b = buf[i]; i += 1
        r |= (b & 0x7f) << s; s += 7
        if not b & 0x80:
            return r, i


def leb(n):
    out = bytearray()
    while True:
        b = n & 0x7f
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


i = 8
sections = []
while i < len(d):
    sid = d[i]; i += 1
    size, j = u32(d, i)
    sections.append((sid, d[j:j + size]))
    i = j + size

out = bytearray(d[:8])
for sid, body in sections:
    if sid == 4:                       # table 段：只留 funcref 那张
        cnt, p = u32(body, 0)
        tables = []
        for _ in range(cnt):
            et = body[p]; p += 1
            flags, p = u32(body, p)
            mn, p = u32(body, p)
            mx = None
            if flags & 1:
                mx, p = u32(body, p)
            tables.append((et, flags, mn, mx))
        funcref = [t for t in tables if t[0] == 0x70]
        assert len(funcref) == 1, tables
        et, flags, mn, mx = funcref[0]
        nb = bytearray(leb(1))
        nb.append(et)
        nb += leb(flags)
        nb += leb(mn)
        if flags & 1:
            nb += leb(mx)
        body = bytes(nb)
        print('table: %d -> 1' % cnt)
    elif sid == 7:                     # export 段：删掉 externref 表的导出
        cnt, p = u32(body, 0)
        entries = []
        for _ in range(cnt):
            ln, p = u32(body, p)
            name = body[p:p + ln]; p += ln
            kind = body[p]; p += 1
            idx, p = u32(body, p)
            entries.append((name, kind, idx))
        kept = [e for e in entries if e[1] != 1]
        for name, kind, _ in entries:
            if kind == 1:
                print('drop export:', name.decode())
        nb = bytearray(leb(len(kept)))
        for name, kind, idx in kept:
            nb += leb(len(name)) + name
            nb.append(kind)
            nb += leb(idx)
        body = bytes(nb)
    out.append(sid)
    out += leb(len(body))
    out += body

open(PATH, 'wb').write(bytes(out))
print('written', PATH, len(out), 'bytes (was %d)' % len(d))
