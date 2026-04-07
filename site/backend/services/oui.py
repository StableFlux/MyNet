"""
OUI (Organizationally Unique Identifier) lookup.
Maps the first 3 octets of a MAC address to a manufacturer name.
This is a curated subset covering common home/office devices — not exhaustive.
"""

# fmt: off
_OUI: dict[str, str] = {
    # ── Raspberry Pi ─────────────────────────────────────────────────────────
    "B827EB": "Raspberry Pi Foundation",
    "DC4F22": "Raspberry Pi Trading",
    "E45F01": "Raspberry Pi Trading",
    "D83ADD": "Raspberry Pi Trading",
    "2CCF67": "Raspberry Pi Trading",

    # ── Apple ────────────────────────────────────────────────────────────────
    "000A27": "Apple", "000A95": "Apple", "000D93": "Apple",
    "001124": "Apple", "001451": "Apple", "0016CB": "Apple",
    "0017F2": "Apple", "001921": "Apple", "001B63": "Apple",
    "001CB3": "Apple", "001D4F": "Apple", "001E52": "Apple",
    "001EC2": "Apple", "001FF3": "Apple", "0021E9": "Apple",
    "002241": "Apple", "002312": "Apple", "002332": "Apple",
    "002436": "Apple", "00254B": "Apple", "002608": "Apple",
    "0026B9": "Apple", "0026BB": "Apple", "003065": "Apple",
    "006171": "Apple", "00C610": "Apple", "040CCE": "Apple",
    "04F7E4": "Apple", "0C4DE9": "Apple", "0C74C2": "Apple",
    "0C77F1": "Apple", "1C1AC0": "Apple", "20A2E4": "Apple",
    "283737": "Apple", "2C1F23": "Apple", "34159E": "Apple",
    "34C059": "Apple", "380F4A": "Apple", "3C0754": "Apple",
    "3C2EFF": "Apple", "402CA8": "Apple", "4098AD": "Apple",
    "44D884": "Apple", "4860BC": "Apple", "48A195": "Apple",
    "4C57CA": "Apple", "4C8D79": "Apple", "5014B2": "Apple",
    "5844D0": "Apple", "60334B": "Apple", "60A10A": "Apple",
    "60D9C7": "Apple", "646020": "Apple", "6C4008": "Apple",
    "6C709F": "Apple", "7086BA": "Apple", "74E1B6": "Apple",
    "7831C1": "Apple", "7CD1C3": "Apple", "888780": "Apple",
    "8C7B9D": "Apple", "90840D": "Apple", "9027E4": "Apple",
    "98B8E3": "Apple", "A45E60": "Apple", "A4B197": "Apple",
    "A4C361": "Apple", "A8667F": "Apple", "A8FAD8": "Apple",
    "ACBC32": "Apple", "ACE433": "Apple", "B418D1": "Apple",
    "B8FF61": "Apple", "BC926B": "Apple", "BCE143": "Apple",
    "C0847A": "Apple", "C41200": "Apple", "C82A14": "Apple",
    "CC29F5": "Apple", "D0A637": "Apple", "D4619D": "Apple",
    "D8BB2C": "Apple", "DC2B2A": "Apple", "E0AC9B": "Apple",
    "E80688": "Apple", "E8B2AC": "Apple", "F0B479": "Apple",
    "F0DBE2": "Apple", "F40F24": "Apple", "F82793": "Apple",
    "FC253F": "Apple",

    # ── Samsung ──────────────────────────────────────────────────────────────
    "001599": "Samsung", "0015B9": "Samsung", "001632": "Samsung",
    "0021D2": "Samsung", "002339": "Samsung", "002566": "Samsung",
    "00265D": "Samsung", "0E9BB8": "Samsung", "107313": "Samsung",
    "1C62B8": "Samsung", "20D390": "Samsung", "2C4401": "Samsung",
    "34145F": "Samsung", "380195": "Samsung", "3CB87A": "Samsung",
    "44F459": "Samsung", "503275": "Samsung", "5056BF": "Samsung",
    "5C0AEB": "Samsung", "600987": "Samsung", "6C2F2C": "Samsung",
    "7050E7": "Samsung", "788102": "Samsung", "8425DB": "Samsung",
    "8C77121": "Samsung", "940F5E": "Samsung", "A8F274": "Samsung",
    "ACC321": "Samsung", "B47443": "Samsung", "BC765E": "Samsung",
    "C0BDD1": "Samsung", "C87E75": "Samsung", "D025DC": "Samsung",
    "E84E06": "Samsung", "F025B7": "Samsung", "F47B5E": "Samsung",
    "FC3FDB": "Samsung",

    # ── Google ───────────────────────────────────────────────────────────────
    "002060": "Google", "1C6AE5": "Google", "3C5AB4": "Google",
    "48D6D5": "Google", "54604A": "Google", "5C5195": "Google",
    "6C5AB5": "Google", "A47733": "Google", "DA4485": "Google",
    "F4F5D8": "Google", "F88FCA": "Google",

    # ── Amazon ───────────────────────────────────────────────────────────────
    "0C47C9": "Amazon", "34D270": "Amazon", "44650D": "Amazon",
    "4C22C4": "Amazon", "68370A": "Amazon", "74C246": "Amazon",
    "84D6D0": "Amazon", "A002DC": "Amazon", "B47C9C": "Amazon",
    "F0272D": "Amazon", "FC65DE": "Amazon",

    # ── Intel (NICs / Wi-Fi) ─────────────────────────────────────────────────
    "001B21": "Intel", "001E67": "Intel", "002170": "Intel",
    "003048": "Intel", "006BDE": "Intel", "08D4CF": "Intel",
    "0CB3B1": "Intel", "18E829": "Intel", "34D399": "Intel",
    "3C970E": "Intel", "400069": "Intel", "406098": "Intel",
    "44850F": "Intel", "489C02": "Intel", "48DBD7": "Intel",
    "4C7997": "Intel", "4C8FA2": "Intel", "54BEF7": "Intel",
    "5C514F": "Intel", "64D4DA": "Intel", "6805CA": "Intel",
    "70B3D5": "Intel", "748114": "Intel", "784F43": "Intel",
    "7C5CF8": "Intel", "80861B": "Intel", "845501": "Intel",
    "88532E": "Intel", "900CE4": "Intel", "94659C": "Intel",
    "9C2A83": "Intel", "A0C589": "Intel", "A0D3C1": "Intel",
    "B0C7B9": "Intel", "B83A5A": "Intel", "C04A00": "Intel",
    "D849C1": "Intel", "E88688": "Intel", "F8322E": "Intel",

    # ── Realtek ──────────────────────────────────────────────────────────────
    "001018": "Realtek", "00E04C": "Realtek", "082E5F": "Realtek",
    "244BFE": "Realtek", "5254AB": "Realtek", "C83A35": "Realtek",
    "E091F5": "Realtek",

    # ── Ubiquiti ─────────────────────────────────────────────────────────────
    "001599": "Ubiquiti", "0418D6": "Ubiquiti", "044E5A": "Ubiquiti",
    "0802B9": "Ubiquiti", "0CD4A0": "Ubiquiti", "18E829": "Ubiquiti",
    "246895": "Ubiquiti", "441CA8": "Ubiquiti", "46E4D6": "Ubiquiti",
    "68D79A": "Ubiquiti", "788A20": "Ubiquiti", "7483C2": "Ubiquiti",
    "802AA8": "Ubiquiti", "9C0525": "Ubiquiti", "AC8BA9": "Ubiquiti",
    "B4FBE4": "Ubiquiti", "DC9FDB": "Ubiquiti", "E063DA": "Ubiquiti",
    "F09FC2": "Ubiquiti", "F4E2C6": "Ubiquiti", "F80F6F": "Ubiquiti",
    "FCECDA": "Ubiquiti",

    # ── TP-Link ──────────────────────────────────────────────────────────────
    "103D59": "TP-Link", "1C61B4": "TP-Link", "1CAFF7": "TP-Link",
    "304A18": "TP-Link", "3460F9": "TP-Link", "400F2B": "TP-Link",
    "50C7BF": "TP-Link", "5416A0": "TP-Link", "5C628B": "TP-Link",
    "601DEC": "TP-Link", "64D154": "TP-Link", "68FF7B": "TP-Link",
    "6C6EFB": "TP-Link", "78E10A": "TP-Link", "7EDBA5": "TP-Link",
    "98DAC4": "TP-Link", "9C5316": "TP-Link", "A42BB0": "TP-Link",
    "AC84C6": "TP-Link", "B0487A": "TP-Link", "B08B23": "TP-Link",
    "B4B024": "TP-Link", "C46E1F": "TP-Link", "C8D3A3": "TP-Link",
    "D8EB97": "TP-Link", "E06066": "TP-Link", "E8DE27": "TP-Link",
    "F0A731": "TP-Link", "F4F26D": "TP-Link", "F81A67": "TP-Link",
    "FC3FDB": "TP-Link",

    # ── ASUS ─────────────────────────────────────────────────────────────────
    "002215": "Asus", "00248C": "Asus", "0026B9": "Asus",
    "04921F": "Asus", "08606E": "Asus", "10BF48": "Asus",
    "1C872C": "Asus", "20CF30": "Asus", "3085A9": "Asus",
    "38D547": "Asus", "40167E": "Asus", "485B39": "Asus",
    "50465D": "Asus", "5404A6": "Asus", "60A44C": "Asus",
    "6C626D": "Asus", "70B5E8": "Asus", "74D02B": "Asus",
    "90E6BA": "Asus", "946093": "Asus", "BC2411": "Asus",
    "C89140": "Asus", "D850E6": "Asus", "E0CB4E": "Asus",
    "E894F6": "Asus", "F046B0": "Asus", "F8721C": "Asus",

    # ── Netgear ──────────────────────────────────────────────────────────────
    "001122": "Netgear", "00146C": "Netgear", "001B2F": "Netgear",
    "001E2A": "Netgear", "002096": "Netgear", "00226B": "Netgear",
    "00247A": "Netgear", "00265B": "Netgear", "0026F2": "Netgear",
    "04A151": "Netgear", "08028E": "Netgear", "0CDCCF": "Netgear",
    "100C6B": "Netgear", "20E52A": "Netgear", "2C3033": "Netgear",
    "3085A9": "Netgear", "4C6004": "Netgear", "58EF68": "Netgear",
    "60374A": "Netgear", "6416B0": "Netgear", "74441A": "Netgear",
    "84B153": "Netgear", "9C3DCF": "Netgear", "A040A0": "Netgear",
    "B00253": "Netgear", "C03F0E": "Netgear", "C4048D": "Netgear",
    "CCAF78": "Netgear", "DC090C": "Netgear", "E091F5": "Netgear",
    "E4F4C6": "Netgear",

    # ── Cisco / Linksys ──────────────────────────────────────────────────────
    "000142": "Cisco", "00016C": "Cisco", "000194": "Cisco",
    "0002FC": "Cisco", "000EB6": "Cisco", "001112": "Cisco",
    "001601": "Cisco", "001B0C": "Cisco", "001C57": "Cisco",
    "001D70": "Cisco", "001E14": "Cisco", "001EBE": "Cisco",
    "002155": "Cisco", "0021A0": "Cisco", "00225D": "Cisco",
    "002564": "Cisco", "0026CB": "Cisco", "00E0F9": "Cisco",
    "045C00": "Cisco", "04DA4D": "Cisco", "040D84": "Cisco",
    "1C6A7A": "Cisco", "206073": "Cisco", "3464A9": "Cisco",
    "3C5EC3": "Cisco", "4403A7": "Cisco", "5065F3": "Cisco",
    "587F57": "Cisco", "60835B": "Cisco", "6CB211": "Cisco",
    "704D7B": "Cisco", "7C0E58": "Cisco", "84B808": "Cisco",
    "8CB64F": "Cisco", "9C7DBF": "Cisco", "A80C0D": "Cisco",
    "B4A4E3": "Cisco", "B83A9D": "Cisco", "CC16EC": "Cisco",
    "D0572E": "Cisco", "D83078": "Cisco", "E8BA70": "Cisco",
    "F04DA2": "Cisco",

    # ── MikroTik ─────────────────────────────────────────────────────────────
    "00163E": "MikroTik", "2CC8FB": "MikroTik", "4C5E0C": "MikroTik",
    "6C3B6B": "MikroTik", "74A36C": "MikroTik", "B8690E": "MikroTik",
    "C4AD34": "MikroTik", "D4CA6D": "MikroTik", "DC2C6E": "MikroTik",
    "E4956E": "MikroTik",

    # ── Dell ─────────────────────────────────────────────────────────────────
    "001372": "Dell", "001A4B": "Dell", "001EC9": "Dell",
    "0021F6": "Dell", "00221A": "Dell", "00234E": "Dell",
    "002564": "Dell", "002638": "Dell", "18A99B": "Dell",
    "1C40AF": "Dell", "24B6FD": "Dell", "28F10E": "Dell",
    "348A7B": "Dell", "3417EB": "Dell", "3C2C30": "Dell",
    "5C260A": "Dell", "5CBA37": "Dell", "6CB3E5": "Dell",
    "848F69": "Dell", "B083FE": "Dell", "B8AC6F": "Dell",
    "C81F66": "Dell", "D067E5": "Dell", "D4BE99": "Dell",
    "E47936": "Dell", "F48E38": "Dell", "F8DB7F": "Dell",

    # ── HP / Hewlett-Packard ──────────────────────────────────────────────────
    "001083": "HP", "001560": "HP", "0017A4": "HP",
    "001A4B": "HP", "001CC4": "HP", "001E0B": "HP",
    "002128": "HP", "002354": "HP", "002569": "HP",
    "0025B3": "HP", "00268B": "HP", "001CBF": "HP",
    "08:00:09": "HP", "10604B": "HP", "18A505": "HP",
    "1CC1DE": "HP", "2816A8": "HP", "3C98EB": "HP",
    "40B034": "HP", "6CE87C": "HP", "70879B": "HP",
    "909790": "HP", "98E7F4": "HP", "9CB654": "HP",
    "A0B3CC": "HP", "A0D3C1": "HP", "B499BA": "HP",
    "C8D9D2": "HP", "D4853B": "HP", "D850E6": "HP",
    "E843B3": "HP", "F0921C": "HP",

    # ── Lenovo ───────────────────────────────────────────────────────────────
    "000732": "Lenovo", "001C25": "Lenovo", "002275": "Lenovo",
    "0023AE": "Lenovo", "0024BE": "Lenovo", "00D020": "Lenovo",
    "10023F": "Lenovo", "20163B": "Lenovo", "28D244": "Lenovo",
    "3CF49F": "Lenovo", "485E02": "Lenovo", "4C7707": "Lenovo",
    "5016B8": "Lenovo", "6082E4": "Lenovo", "6CAE8B": "Lenovo",
    "703A51": "Lenovo", "78E8B6": "Lenovo", "8C8DC8": "Lenovo",
    "9CD643": "Lenovo", "A4C361": "Lenovo", "B8763F": "Lenovo",
    "C430E0": "Lenovo", "D4C973": "Lenovo",

    # ── Synology ─────────────────────────────────────────────────────────────
    "001132": "Synology", "0011322": "Synology", "BC2441": "Synology",
    "001129": "Synology", "0050F1": "Synology",

    # ── QNAP ─────────────────────────────────────────────────────────────────
    "000D93": "QNAP", "24580F": "QNAP", "9C69B4": "QNAP",
    "A02890": "QNAP",

    # ── Sonos ────────────────────────────────────────────────────────────────
    "000E58": "Sonos", "34172F": "Sonos", "48A6B8": "Sonos",
    "5CAAFE": "Sonos", "78628E": "Sonos", "94901A": "Sonos",
    "B8E937": "Sonos",

    # ── Philips Hue / Signify ─────────────────────────────────────────────────
    "001788": "Signify (Philips Hue)", "0017880": "Signify (Philips Hue)",
    "EC1BBDBD": "Signify (Philips Hue)", "7C491D": "Signify (Philips Hue)",

    # ── Sony ─────────────────────────────────────────────────────────────────
    "001A80": "Sony", "002023": "Sony", "0024BE": "Sony",
    "2818784": "Sony", "30F9ED": "Sony", "3C4A92": "Sony",
    "4C0B8E": "Sony", "6040BB": "Sony", "70B0D3": "Sony",
    "78843C": "Sony", "ACB05B": "Sony", "B47B7B": "Sony",
    "F8DEFF": "Sony",

    # ── LG ───────────────────────────────────────────────────────────────────
    "001C62": "LG", "0021FB": "LG", "00248D": "LG",
    "001E75": "LG", "14C913": "LG", "1C086B": "LG",
    "202BBD": "LG", "380B40": "LG", "40A8F3": "LG",
    "48594E": "LG", "60D32E": "LG", "78A2A0": "LG",
    "8C77B6": "LG", "A01A30": "LG", "CC08FB": "LG",
    "E8F2E2": "LG",

    # ── Broadcom ─────────────────────────────────────────────────────────────
    "000AF7": "Broadcom", "001018": "Broadcom", "001AEF": "Broadcom",
    "20ABF8": "Broadcom", "34E8B4": "Broadcom", "744D28": "Broadcom",
    "78F6CB": "Broadcom", "88110A": "Broadcom", "ACD10C": "Broadcom",

    # ── Marvell ──────────────────────────────────────────────────────────────
    "001B4F": "Marvell", "001CF0": "Marvell", "00505B": "Marvell",

    # ── Motorola ─────────────────────────────────────────────────────────────
    "000A28": "Motorola", "000E2E": "Motorola", "00121E": "Motorola",
    "001374": "Motorola", "184455": "Motorola", "ACE254": "Motorola",

    # ── Microsoft ────────────────────────────────────────────────────────────
    "0003FF": "Microsoft", "00125A": "Microsoft", "001DD8": "Microsoft",
    "0050F2": "Microsoft", "28186D": "Microsoft", "3044A1": "Microsoft",
    "48B26F": "Microsoft", "54836D": "Microsoft", "7C1E52": "Microsoft",
    "DC530D": "Microsoft",

    # ── Nintendo ─────────────────────────────────────────────────────────────
    "001656": "Nintendo", "001FC5": "Nintendo", "002709": "Nintendo",
    "002444": "Nintendo", "0022D7": "Nintendo", "00241E": "Nintendo",
    "002659": "Nintendo", "0009BF": "Nintendo", "E00C7F": "Nintendo",
    "E84ECE": "Nintendo",

    # ── Shelly ───────────────────────────────────────────────────────────────
    "C45BBE": "Shelly", "3494B4": "Shelly",

    # ── Tuya / Smart Life ────────────────────────────────────────────────────
    "A84EE4": "Tuya", "D496E0": "Tuya",

    # ── VMware (virtual NICs) ─────────────────────────────────────────────────
    "000C29": "VMware", "000569": "VMware", "001C14": "VMware",
    "005056": "VMware",

    # ── QEMU / KVM ───────────────────────────────────────────────────────────
    "525400": "QEMU/KVM", "5254000": "QEMU/KVM",

    # ── Docker (bridge) ──────────────────────────────────────────────────────
    "0242AC": "Docker",
}
# fmt: on


def lookup_manufacturer(mac: str) -> str:
    """Return manufacturer name for a MAC address, or empty string if unknown."""
    if not mac:
        return ""
    prefix = mac.replace(":", "").replace("-", "").upper()[:6]
    return _OUI.get(prefix, "")
