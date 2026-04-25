"""
geohash_pure.py
~~~~~~~~~~~~~~~
零依赖的 geohash 实现，覆盖本项目所需的三个操作：
  - encode(lat, lng, precision)  → geohash 字符串
  - decode_bbox(gh)              → (min_lat, max_lat, min_lng, max_lng)
  - get_adjacent(gh, direction)  → 相邻 geohash ('top'/'bottom'/'left'/'right')

Geohash 规范参考：
  http://geohash.org/  &  https://github.com/davetroy/geohash-js
"""

# ── 常量 ──────────────────────────────────────────────────────────────────────

# geohash 专用 base32 字母表（去掉 a/i/l/o 避免歧义）
BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
BASE32_MAP = {c: i for i, c in enumerate(BASE32)}  # 字符 → 数值

# 邻居查找表（来源：Dave Troy geohash-js）
# key: direction, value: {parity: lookup_string}
#   parity "even" = len(geohash) % 2 == 0
#   lookup_string[i] 对应 BASE32[i] 在该方向上的邻居末字符
_NEIGHBORS = {
    "right": {
        "even": "bc01fg45238967deuvhjyznpkmstqrwx",
        "odd":  "p0r21436x8zb9dcf5h7kjnmqesgutwvy",
    },
    "left": {
        "even": "238967debc01fg45kmstqrwxuvhjyznp",
        "odd":  "14365h7k9dcfesgujnmqp0r2twvyx8zb",
    },
    "top": {
        "even": "p0r21436x8zb9dcf5h7kjnmqesgutwvy",
        "odd":  "bc01fg45238967deuvhjyznpkmstqrwx",
    },
    "bottom": {
        "even": "14365h7k9dcfesgujnmqp0r2twvyx8zb",
        "odd":  "238967debc01fg45kmstqrwxuvhjyznp",
    },
}

# 边界字符：若末字符在此集合中，父格子也需要移位（递归处理）
_BORDERS = {
    "right":  {"even": "bcfguvyz", "odd": "prxz"},
    "left":   {"even": "0145hjnp", "odd": "028b"},
    "top":    {"even": "prxz",     "odd": "bcfguvyz"},
    "bottom": {"even": "028b",     "odd": "0145hjnp"},
}


# ── encode ────────────────────────────────────────────────────────────────────

def encode(lat: float, lng: float, precision: int = 6) -> str:
    """
    将 (lat, lng) 编码为指定精度的 geohash 字符串。

    算法：对经纬度交替做二分，每 5 位映射一个 base32 字符。
    - 偶数位（0,2,4,…）：对经度二分
    - 奇数位（1,3,5,…）：对纬度二分
    """
    lat_lo, lat_hi = -90.0,  90.0
    lng_lo, lng_hi = -180.0, 180.0

    result = []
    bit_buf = 0   # 当前积累的 5 位值
    bit_cnt = 0   # 已积累的位数
    even = True   # True = 本位处理经度

    total_bits = precision * 5
    for _ in range(total_bits):
        if even:                           # 经度二分
            mid = (lng_lo + lng_hi) / 2
            if lng >= mid:
                bit_buf = (bit_buf << 1) | 1
                lng_lo = mid
            else:
                bit_buf = bit_buf << 1
                lng_hi = mid
        else:                              # 纬度二分
            mid = (lat_lo + lat_hi) / 2
            if lat >= mid:
                bit_buf = (bit_buf << 1) | 1
                lat_lo = mid
            else:
                bit_buf = bit_buf << 1
                lat_hi = mid

        even = not even
        bit_cnt += 1

        if bit_cnt == 5:                   # 满 5 位 → 输出一个字符
            result.append(BASE32[bit_buf])
            bit_buf = 0
            bit_cnt = 0

    return "".join(result)


# ── decode_bbox ───────────────────────────────────────────────────────────────

def decode_bbox(gh: str) -> tuple[float, float, float, float]:
    """
    将 geohash 字符串解码为其对应的矩形边界框。

    返回 (min_lat, max_lat, min_lng, max_lng)。

    算法：将 base32 字符逐个展开为 5 个二进制位，
    偶数位收缩经度区间，奇数位收缩纬度区间。
    """
    lat_lo, lat_hi = -90.0,  90.0
    lng_lo, lng_hi = -180.0, 180.0
    even = True  # 第一位处理经度

    for char in gh:
        val = BASE32_MAP[char]
        for bit_pos in range(4, -1, -1):   # 高位到低位
            bit = (val >> bit_pos) & 1
            if even:
                mid = (lng_lo + lng_hi) / 2
                if bit:
                    lng_lo = mid
                else:
                    lng_hi = mid
            else:
                mid = (lat_lo + lat_hi) / 2
                if bit:
                    lat_lo = mid
                else:
                    lat_hi = mid
            even = not even

    return lat_lo, lat_hi, lng_lo, lng_hi


# ── get_adjacent ──────────────────────────────────────────────────────────────

def get_adjacent(gh: str, direction: str) -> str:
    """
    计算 geohash 在指定方向上的相邻格子。

    direction: 'top' | 'bottom' | 'left' | 'right'

    算法（基于查找表，O(precision) 递归）：
    1. 取末字符和前缀
    2. 根据 hash 长度的奇偶性选择查找表
    3. 若末字符在"边界集合"内，前缀格子也需要移位（递归）
    4. 用查找表将末字符映射到邻居的末字符
    """
    if not gh:
        raise ValueError("geohash 不能为空")

    gh = gh.lower()
    last = gh[-1]
    base = gh[:-1]

    # 奇偶性：len 为偶数 → "even"，为奇数 → "odd"
    parity = "even" if len(gh) % 2 == 0 else "odd"

    nb_table  = _NEIGHBORS[direction][parity]
    bdr_table = _BORDERS[direction][parity]

    # 若末字符在边界上，父格子也需要移位
    if last in bdr_table and base:
        base = get_adjacent(base, direction)

    return base + BASE32[nb_table.index(last)]


# ── 便捷函数 ──────────────────────────────────────────────────────────────────

def neighbors(gh: str) -> dict[str, str]:
    """返回四个方向的相邻 geohash：{'top', 'bottom', 'left', 'right'}。"""
    return {d: get_adjacent(gh, d) for d in ("top", "bottom", "left", "right")}


def decode(gh: str) -> tuple[float, float]:
    """返回 geohash 对应矩形的中心点 (lat, lng)。"""
    min_lat, max_lat, min_lng, max_lng = decode_bbox(gh)
    return (min_lat + max_lat) / 2, (min_lng + max_lng) / 2


# ── 自测 ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    # 基本正确性验证
    cases = [
        (31.2304, 121.4737, 5),   # 上海
        (39.9042, 116.4074, 6),   # 北京
        (22.5431, 114.0579, 7),   # 深圳
    ]
    print(f"{'lat':>10} {'lng':>11} {'prec':>5}  {'geohash':>10}  {'re-decoded center':>30}")
    print("-" * 75)
    for lat, lng, prec in cases:
        gh = encode(lat, lng, prec)
        clat, clng = decode(gh)
        print(f"{lat:10.4f} {lng:11.4f} {prec:>5}  {gh:>10}  lat={clat:.5f} lng={clng:.5f}")

    # 邻居验证
    print()
    gh = encode(31.2304, 121.4737, 5)
    print(f"geohash={gh} 的四邻:")
    for d, nb in neighbors(gh).items():
        min_lat, max_lat, min_lng, max_lng = decode_bbox(nb)
        print(f"  {d:8s}: {nb}  bbox=[{min_lat:.4f},{max_lat:.4f},{min_lng:.4f},{max_lng:.4f}]")

    # 与已知参考值对比（geohash.org 上可验证）
    print()
    ref = [
        ("wtw3s", encode(31.2232, 121.4868, 5)),
        ("wx4g0", encode(39.9042, 116.4074, 5)),
    ]
    for expected, got in ref:
        status = "OK" if expected == got else f"MISMATCH (got {got})"
        print(f"  expected={expected}  →  {status}")

    if len(sys.argv) > 1:
        # 命令行快速编码
        lat, lng = float(sys.argv[1]), float(sys.argv[2])
        prec = int(sys.argv[3]) if len(sys.argv) > 3 else 6
        print(f"\nencode({lat}, {lng}, {prec}) = {encode(lat, lng, prec)}")
