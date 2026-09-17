# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = ['core', 'tools']
hiddenimports += collect_submodules('core')
hiddenimports += collect_submodules('tools')


a = Analysis(
    ['omerta_entry.py'],
    pathex=[],
    binaries=[],
    datas=[('skills', 'skills'), ('plugins', 'plugins'), ('webui', 'webui'), ('assets', 'assets'), ('scripts', 'scripts'), ('firmware', 'firmware'), ('persona.yaml', '.'), ('connectors.yaml', '.'), ('pyproject.toml', '.')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'cryptography', 'OpenSSL'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='omerta',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
