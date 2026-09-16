# OMERTA AI — TCL T509K starter BoardConfig
#
# Board-specific values must be confirmed from the actual
# stock firmware and matching kernel/BSP.

TARGET_ARCH := arm64
TARGET_ARCH_VARIANT := armv8-a
TARGET_CPU_VARIANT := generic

# -------------------------------------------------
# BOOT IMAGE
# -------------------------------------------------
#
# Do NOT enable these until confirmed from stock boot.img.
#
# BOARD_BOOT_HEADER_VERSION :=
# BOARD_KERNEL_IMAGE_NAME :=
# BOARD_MKBOOTIMG_ARGS :=
# BOARD_KERNEL_CMDLINE :=

# -------------------------------------------------
# PARTITIONS
# -------------------------------------------------
#
# Do NOT invent partition sizes.
#
# BOARD_FLASH_BLOCK_SIZE :=
# BOARD_SUPER_PARTITION_SIZE :=

# -------------------------------------------------
# KERNEL
# -------------------------------------------------
#
# Populate only after identifying the matching kernel.
#
# TARGET_KERNEL_SOURCE :=
# TARGET_KERNEL_CONFIG :=

# Device path

DEVICE_PATH := device/tcl/t509k
