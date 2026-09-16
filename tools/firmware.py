"""Firmware / cross-compile command builders.

Command strings only — execution goes through the approval gate. Matches the
toolchain patterns used in the bootloader-toolkit / ios-tooling-builder work.
"""

CROSS_TOOLCHAINS = {
    "armv7l": "arm-linux-gnueabihf",
    "aarch64": "aarch64-linux-gnu",
    "armv7l-android": "armv7a-linux-androideabi",
    "aarch64-android": "aarch64-linux-android",
    "riscv64": "riscv64-linux-gnu",
}


def cross_compile_cmd(source, target_arch, output, extra_flags=""):
    triple = CROSS_TOOLCHAINS.get(target_arch)
    if not triple:
        return (f"# unknown arch '{target_arch}'. "
                f"known: {', '.join(CROSS_TOOLCHAINS)}")
    return f"{triple}-gcc {extra_flags} -o {output} {source}".replace("  ", " ")


def autotools_cross_cmd(project_dir, host_triple, extra=""):
    return (f"cd {project_dir} && ./autogen.sh --host={host_triple} "
            f"--prefix=$(pwd)/build-{host_triple} {extra} && "
            f"make -j$(nproc) && make install")


def check_elf_cmd(binary_path):
    return f"file {binary_path} && readelf -h {binary_path}"


def flash_cmd(image, partition):
    """Always high-risk — the gate will flag it loudly."""
    return f"fastboot flash {partition} {image}"


def backup_partition_cmd(partition, out="/sdcard"):
    return (f"adb shell su -c 'dd if=/dev/block/by-name/{partition} "
            f"of={out}/{partition}-backup.img'")
