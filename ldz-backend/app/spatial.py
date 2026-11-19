from collections.abc import Iterable
from typing import TypedDict

from pyproj import Geod

WGS84 = Geod(ellps="WGS84")


class Candidate(TypedDict):
    id: int
    category: str
    status: str
    longitude: float
    latitude: float


def find_nearby(
    longitude: float,
    latitude: float,
    radius_m: float,
    candidates: Iterable[Candidate],
) -> list[dict]:
    """接收已按类别和未解决状态筛选的工单，返回按距离升序排列的匹配。"""
    matches = []
    for candidate in candidates:
        _, _, distance = WGS84.inv(
            longitude, latitude, candidate["longitude"], candidate["latitude"]
        )
        # 纳米级容差处理浮点计算恰好落在阈值的情况。
        if distance <= radius_m + 1e-8:
            matches.append((distance, candidate))

    matches.sort(key=lambda match: (match[0], match[1]["id"]))
    return [
        {
            "id": candidate["id"],
            "category": candidate["category"],
            "status": candidate["status"],
            "distance_m": round(distance, 2),
        }
        for distance, candidate in matches
    ]
