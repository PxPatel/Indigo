import io
from typing import Protocol, runtime_checkable
from models.schemas import Transaction


@runtime_checkable
class BrokerageParser(Protocol):
    @staticmethod
    def can_parse(headers: list[str]) -> bool: ...

    @staticmethod
    def parse(file: io.StringIO) -> list[Transaction]: ...
