from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, model_validator

MAX_RECORD_ID = 2**63 - 1
CATEGORY_PATTERN = r"^[a-z][a-z0-9_-]{0,39}$"
Category = Annotated[str, StringConstraints(pattern=CATEGORY_PATTERN)]
Status = Literal["pending", "processing", "resolved"]
Source = Literal["student", "inspection"]
RecordId = Annotated[int, Field(strict=True, gt=0, le=MAX_RECORD_ID)]
Longitude = Annotated[float, Field(strict=True, ge=-180, le=180, allow_inf_nan=False)]
Latitude = Annotated[float, Field(strict=True, ge=-90, le=90, allow_inf_nan=False)]
Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120, pattern=r"^[^\x00]+$")
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000, pattern=r"^[^\x00]+$")
]
LocationDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=200, pattern=r"^[^\x00]*$")
]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000, pattern=r"^[^\x00]*$")]


class IssueCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category
    title: Title
    description: Description
    longitude: Longitude
    latitude: Latitude
    location_description: LocationDescription = ""
    source: Source = "student"
    is_mock: Annotated[bool, Field(strict=True)] = True
    facility_id: RecordId | None = None


class IssuePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category | None = None
    title: Title | None = None
    description: Description | None = None
    longitude: Longitude | None = None
    latitude: Latitude | None = None
    location_description: LocationDescription | None = None
    status: Status | None = None
    source: Source | None = None
    note: Note | None = None
    facility_id: RecordId | None = None

    @model_validator(mode="after")
    def validate_patch(self):
        if not self.model_fields_set:
            raise ValueError("请至少提交一个要修改的字段")
        for field in self.model_fields_set - {"facility_id"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} 不能为 null")
        return self


class Issue(BaseModel):
    id: int
    category: str
    title: str
    description: str
    longitude: float
    latitude: float
    location_description: str
    status: Status
    source: Source
    note: str
    is_mock: bool
    facility_id: int | None
    created_at: datetime
    updated_at: datetime


class Facility(BaseModel):
    id: int
    name: str
    category: str
    longitude: float
    latitude: float
    source: str
    is_mock: bool


class NearbyIssue(BaseModel):
    id: int
    category: str
    status: Status
    distance_m: float


class NearbyResult(BaseModel):
    items: list[NearbyIssue]
    count: int
    radius_m: float


class IssueStats(BaseModel):
    total: int
    by_status: dict[str, int]
    by_category: dict[str, int]


class AccountCredentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: Annotated[
        str,
        StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^[A-Za-z][A-Za-z0-9_]{2,31}$"),
    ]
    password: Annotated[SecretStr, Field(min_length=8, max_length=128)]


class Account(BaseModel):
    id: int
    username: str
    created_at: datetime


class AccountLogin(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    account: Account
