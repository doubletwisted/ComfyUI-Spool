def wire(value):
    if type(value) is int and abs(value) > 9007199254740991:
        return {"__spool_int__": str(value)}
    if isinstance(value, dict):
        return {k: wire(v) for k, v in value.items()}
    if isinstance(value, list):
        return [wire(v) for v in value]
    return value


def unwire(value):
    if isinstance(value, dict):
        if set(value) == {"__spool_int__"}:
            decimal = value["__spool_int__"]
            if not isinstance(decimal, str) or not decimal.lstrip("-").isdigit():
                raise ValueError("Integer controls require an exact decimal string")
            return int(decimal)
        return {k: unwire(v) for k, v in value.items()}
    if isinstance(value, list):
        return [unwire(v) for v in value]
    return value
