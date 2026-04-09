from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # Database
    db_path: str = str(Path(__file__).parent / "mynet.db")

    # App
    app_host: str = "localhost"
    app_port: int = 8000

    # PiHole (optional — leave blank to disable)
    pihole1_url: str = ""
    pihole2_url: str = ""
    pihole_poll_interval_secs: int = 300

    # Monitoring
    monitoring_max_concurrent_pings: int = 20
    monitoring_default_interval_secs: int = 60
    monitoring_failure_threshold: int = 3

    # Auth / JWT
    jwt_secret_key: str = ""
    jwt_expire_minutes: int = 480  # 8 hours

    # CORS — comma-separated list of allowed origins (exact match).
    # If empty, falls back to allowing all private-network IP ranges (LAN-only default).
    # Example: CORS_ORIGINS=https://mynet.home,http://192.168.1.100
    cors_origins: str = ""

    # QR / Labels
    qr_label_width_px: int = 696   # Brother P950NW 24mm tape at 300dpi
    qr_label_height_px: int = 272

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
