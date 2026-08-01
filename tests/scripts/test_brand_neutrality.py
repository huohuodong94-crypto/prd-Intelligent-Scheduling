from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PROHIBITED_MARKERS = (
    ("legacy-retail-brand-latin", "".join(("adi", "das"))),
    ("legacy-retail-brand-cjk", "".join(("阿迪", "达斯"))),
    ("legacy-cloud-identity-brand", "".join(("azure", "ad"))),
    ("legacy-cloud-identity-brand-spaced", "".join(("azure", " ad"))),
)


class BrandNeutralityTests(unittest.TestCase):
    def test_tracked_text_has_no_prohibited_legacy_brand(self) -> None:
        result = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
        )
        violations: list[str] = []
        for encoded_path in result.stdout.split(b"\0"):
            if not encoded_path:
                continue
            relative_path = Path(os.fsdecode(encoded_path))
            path = REPOSITORY_ROOT / relative_path
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8").casefold()
            except UnicodeDecodeError:
                continue
            for label, marker in PROHIBITED_MARKERS:
                if marker.casefold() in text:
                    violations.append(f"{relative_path}: {label}")

        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
