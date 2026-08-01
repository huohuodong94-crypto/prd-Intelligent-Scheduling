#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
import hashlib
from html import escape
import os
from pathlib import Path
import re
import subprocess
import tempfile


EXPECTED_SLIDE_COUNT = 63
OUTPUT_DIRECTORY = Path("test-results/ppt-reference")
SLIDE_NAME = re.compile(r"^slide-(\d+)\.png$")
CJK_FONT_CANDIDATES = (
    "Hiragino Sans GB W3",
    "Hiragino Sans GB",
    "PingFang SC",
    "Heiti SC",
    "Arial Unicode MS",
)
REQUIRED_PPT_TEXT = (
    "店长审批",
    "门店信息",
    "智能排班排班管理创建计划",
    "异常处理",
    "考勤管理考勤异常日明细异常处理和异常确认",
    "考勤管理考勤异常月汇总异常处理和异常确认",
    "到此结束谢谢",
)
REQUIRED_CJK_CHARACTERS = frozenset(
    character
    for text in REQUIRED_PPT_TEXT
    for character in text
    if "\u3400" <= character <= "\u9fff"
)
DEFAULT_KEYNOTE_APP = Path("/Applications/Keynote.app")
KEYNOTE_EXPORT_TIMEOUT_SECONDS = 180
KEYNOTE_EXPORT_SCRIPT = """\
on run argv
  set sourcePath to item 1 of argv
  set destinationPath to item 2 of argv
  tell application "Keynote"
    set existingDocumentIds to id of every document
    open POSIX file sourcePath
    set sourceDocumentId to missing value
    repeat with pollIndex from 1 to 120
      repeat with candidateDocument in documents
        set candidateDocumentId to (id of candidateDocument) as text
        if existingDocumentIds does not contain candidateDocumentId then
          set sourceDocumentId to (candidateDocumentId as text)
          exit repeat
        end if
      end repeat
      if sourceDocumentId is not missing value then exit repeat
      delay 0.25
    end repeat
    if sourceDocumentId is missing value then ¬
      error "Keynote did not create a new document after open" number 7301
    try
      export (document id sourceDocumentId) to POSIX file destinationPath as PDF
    on error errorMessage number errorNumber
      try
        close (document id sourceDocumentId) saving no
      end try
      error errorMessage number errorNumber
    end try
    close (document id sourceDocumentId) saving no
  end tell
end run
"""


def source_from_environment() -> Path:
    source_value = os.environ.get("WFM_PPT_REFERENCE", "").strip()
    if not source_value:
        raise SystemExit(
            "WFM_PPT_REFERENCE must point to the authorized visual reference deck."
        )
    return Path(source_value)


@dataclass(frozen=True)
class FontChoice:
    path: Path
    family: str
    languages: str


def remove_render_artifacts(output: Path, pdf: Path) -> None:
    for previous in output.glob("slide-*.png"):
        previous.unlink()
    for temporary in output.glob(".wfm-slide-*.png"):
        temporary.unlink()
    pdf.unlink(missing_ok=True)


def slide_number(path: Path) -> int:
    match = SLIDE_NAME.fullmatch(path.name)
    if match is None:
        raise SystemExit(f"unexpected rendered slide name: {path.name}")
    return int(match.group(1))


def command_output(command: list[str], environment: dict[str, str] | None = None) -> str:
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            env=environment,
        )
    except FileNotFoundError as error:
        raise SystemExit(
            f"Required command not found: {command[0]}. Install Fontconfig and retry."
        ) from error
    return result.stdout.strip()


def font_match(family: str, environment: dict[str, str] | None = None) -> FontChoice:
    lines = command_output(
        ["fc-match", "-f", "%{file}\\n%{family}\\n%{lang}\\n", family],
        environment,
    ).splitlines()
    if len(lines) < 3:
        raise SystemExit(f"fc-match returned incomplete metadata for {family}")
    return FontChoice(Path(lines[0]), lines[1], lines[2])


def parse_font_charset(value: str) -> set[int]:
    codepoints: set[int] = set()
    for token in value.split():
        if "-" in token:
            start_text, end_text = token.split("-", maxsplit=1)
            try:
                start = int(start_text, 16)
                end = int(end_text, 16)
            except ValueError:
                continue
            codepoints.update(range(start, end + 1))
        else:
            try:
                codepoints.add(int(token, 16))
            except ValueError:
                continue
    return codepoints


def font_missing_required_characters(font: Path) -> list[str]:
    try:
        charset = command_output(["fc-query", "-f", "%{charset}\\n", str(font)])
    except FileNotFoundError as error:
        raise SystemExit(
            "Required command not found: fc-query. Install Fontconfig and retry."
        ) from error
    covered = parse_font_charset(charset)
    return sorted(
        character
        for character in REQUIRED_CJK_CHARACTERS
        if ord(character) not in covered
    )


def choose_system_cjk_font() -> FontChoice:
    fonts_without_coverage: list[tuple[FontChoice, list[str]]] = []
    for candidate in CJK_FONT_CANDIDATES:
        choice = font_match(candidate)
        if not choice.path.is_file() or "zh" not in choice.languages.lower():
            continue
        missing = font_missing_required_characters(choice.path)
        if not missing:
            return choice
        fonts_without_coverage.append((choice, missing))

    if fonts_without_coverage:
        choice, missing = fonts_without_coverage[0]
        preview = "".join(missing[:12])
        raise SystemExit(
            f"CJK font {choice.family} does not cover required PPT characters: {preview}"
        )
    raise SystemExit(
        "No usable system CJK font. Install Arial Unicode MS, Hiragino Sans GB, "
        "Heiti SC or PingFang SC, then rerun."
    )


def write_fontconfig(config: Path, cache: Path, font: FontChoice) -> None:
    directories = {
        font.path.parent,
        Path("/System/Library/Fonts"),
        Path("/System/Library/Fonts/Supplemental"),
        Path("/Library/Fonts"),
    }
    directory_entries = "\n".join(
        f"  <dir>{escape(str(directory))}</dir>"
        for directory in sorted(directories, key=str)
        if directory.is_dir()
    )
    aliases = "\n".join(
        (
            "  <alias binding=\"strong\">\n"
            f"    <family>{escape(source_family)}</family>\n"
            f"    <prefer><family>{escape(font.family)}</family></prefer>\n"
            "  </alias>"
        )
        for source_family in ("MiSans Normal", "MiSans Medium", "微软雅黑")
    )
    config.write_text(
        "\n".join(
            (
                '<?xml version="1.0"?>',
                '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
                "<fontconfig>",
                directory_entries,
                f"  <cachedir>{escape(str(cache))}</cachedir>",
                aliases,
                "</fontconfig>",
                "",
            )
        ),
        encoding="utf-8",
    )


def require_fontconfig_mapping(environment: dict[str, str], expected: FontChoice) -> None:
    actual = font_match("MiSans Normal", environment)
    try:
        same_file = actual.path.resolve() == expected.path.resolve()
    except FileNotFoundError:
        same_file = False
    if not same_file or "zh" not in actual.languages.lower():
        raise SystemExit(
            "Fontconfig failed to map MiSans Normal to the validated CJK font. "
            f"Expected {expected.path}, got {actual.path}."
        )


def require_distinct_section_renders(slides: list[Path]) -> None:
    paths = [slides[index - 1] for index in (13, 15, 52)]
    digests = {hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    if len(digests) != len(paths):
        raise SystemExit("render collision for distinct slides 13, 15 and 52")


def export_pdf_with_keynote(source: Path, pdf: Path, temporary: Path) -> str:
    keynote_app = Path(os.environ.get("WFM_KEYNOTE_APP", str(DEFAULT_KEYNOTE_APP)))
    if not keynote_app.is_dir():
        raise SystemExit(
            "Keynote is required for this PPT because LibreOffice clips critical "
            "Chinese titles. Install Keynote or explicitly set "
            "WFM_PPT_RENDERER=libreoffice for diagnostic rendering only."
        )
    apple_script = temporary / "export-keynote-pdf.applescript"
    apple_script.write_text(KEYNOTE_EXPORT_SCRIPT, encoding="utf-8")
    try:
        subprocess.run(
            ["osascript", str(apple_script), str(source.resolve()), str(pdf.resolve())],
            check=True,
            capture_output=True,
            text=True,
            timeout=KEYNOTE_EXPORT_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as error:
        raise SystemExit(
            "Keynote export requires osascript, which is unavailable on this system."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise SystemExit(
            f"Keynote export timed out after {KEYNOTE_EXPORT_TIMEOUT_SECONDS} seconds."
        ) from error
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        if not detail:
            detail = f"osascript exited with status {error.returncode}"
        raise SystemExit(f"Keynote export failed: {detail}") from error
    return f"Keynote ({keynote_app})"


def export_pdf_with_libreoffice(source: Path, pdf: Path, temporary: Path) -> str:
    cjk_font = choose_system_cjk_font()
    fontconfig = temporary / "fonts.conf"
    font_cache = temporary / "font-cache"
    libreoffice_profile = temporary / "libreoffice-profile"
    write_fontconfig(fontconfig, font_cache, cjk_font)
    render_environment = os.environ.copy()
    render_environment["FONTCONFIG_FILE"] = str(fontconfig)
    require_fontconfig_mapping(render_environment, cjk_font)
    try:
        subprocess.run(
            [
                "soffice",
                f"-env:UserInstallation={libreoffice_profile.resolve().as_uri()}",
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                str(pdf.parent),
                str(source),
            ],
            check=True,
            env=render_environment,
        )
    except FileNotFoundError as error:
        raise SystemExit(
            "LibreOffice diagnostic rendering requires soffice, which is unavailable."
        ) from error
    return f"LibreOffice diagnostic fallback {cjk_font.family} ({cjk_font.path})"


def main() -> None:
    source = source_from_environment()
    if not source.is_file():
        raise SystemExit(f"PPT reference not found: {source}")

    output = OUTPUT_DIRECTORY
    output.mkdir(parents=True, exist_ok=True)
    pdf = output / f"{source.stem}.pdf"
    remove_render_artifacts(output, pdf)

    try:
        with tempfile.TemporaryDirectory(prefix="wfm-ppt-render-") as temporary:
            temporary_directory = Path(temporary)
            renderer = os.environ.get("WFM_PPT_RENDERER", "keynote").lower()
            if renderer == "keynote":
                render_description = export_pdf_with_keynote(
                    source, pdf, temporary_directory
                )
            elif renderer == "libreoffice":
                render_description = export_pdf_with_libreoffice(
                    source, pdf, temporary_directory
                )
            else:
                raise SystemExit(
                    "WFM_PPT_RENDERER must be 'keynote' or 'libreoffice', "
                    f"got {renderer!r}."
                )
            if not pdf.is_file():
                raise SystemExit(f"PPT renderer did not create the expected PDF: {pdf}")

            subprocess.run(
                [
                    "pdftoppm",
                    "-png",
                    "-r",
                    "120",
                    str(pdf),
                    str(output / "slide"),
                ],
                check=True,
            )
        slides = sorted(output.glob("slide-*.png"), key=slide_number)
        if len(slides) != EXPECTED_SLIDE_COUNT:
            raise SystemExit(
                f"expected exactly {EXPECTED_SLIDE_COUNT} slides, got {len(slides)}"
            )
        require_distinct_section_renders(slides)

        temporary_slides: list[Path] = []
        for index, slide in enumerate(slides, start=1):
            temporary = output / f".wfm-slide-{index:03d}.png"
            slide.replace(temporary)
            temporary_slides.append(temporary)
        for index, temporary in enumerate(temporary_slides, start=1):
            temporary.replace(output / f"slide-{index:03d}.png")
        print(
            f"Rendered {EXPECTED_SLIDE_COUNT} slides using {render_description}"
        )
    except BaseException:
        remove_render_artifacts(output, pdf)
        raise
    finally:
        pdf.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
