import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface MakefileConfig {
    projectPath: string;
    projectName: string;
    compilerPath: string;
    sdkPath: string;
    includePaths: string[];
    libraryPaths: string[];
    sourceFiles: string[];
    entryPointFile: string;
    entryPointBaseName: string;
    outputPath: string;
    optimization: 'debug' | 'release';
    device: string;
}

export class MakefileGenerator {
    /**
     * Generate Makefile and supporting .mk files for the project
     */
    static generateMakefiles(config: MakefileConfig): void {
        const buildDir = config.outputPath;

        // Ensure build directory exists
        if (!fs.existsSync(buildDir)) {
            fs.mkdirSync(buildDir, { recursive: true });
        }

        // Generate main Makefile
        this.generateMainMakefile(config);

        // Generate compiler flags .mk file
        this.generateCompilerMk(config);

        // Generate sources .mk file
        this.generateSourcesMk(config);

        // Generate linker .mk file
        this.generateLinkerMk(config);
    }

    private static generateMainMakefile(config: MakefileConfig): void {
        const makefilePath = path.join(config.outputPath, 'Makefile');

        const content = `# Automatically generated Makefile for ${config.projectName}
# Generated: ${new Date().toISOString()}

# Project Configuration
PROJECT_NAME := ${config.entryPointBaseName}
BUILD_DIR := .
OUTPUT_DIR := .

# Include configuration files
include compiler.mk
include sources.mk
include linker.mk

# Build Targets
.PHONY: all clean

all: \$(OUTPUT_DIR)/\$(PROJECT_NAME).out \$(OUTPUT_DIR)/\$(PROJECT_NAME).hex \$(OUTPUT_DIR)/\$(PROJECT_NAME).elf

# Main build target
\$(OUTPUT_DIR)/\$(PROJECT_NAME).out: \$(OBJECTS)
\t@echo "Building target: $@"
\t@echo "Invoking: TI ARM Clang Linker"
\t\$(CC) \$(CFLAGS) \$(LDFLAGS) -o "$@" \$(OBJECTS) \$(LIBS)
\t@echo "Finished building target: $@"

# Generate HEX file
\$(OUTPUT_DIR)/\$(PROJECT_NAME).hex: \$(OUTPUT_DIR)/\$(PROJECT_NAME).out
\t@echo "Generating HEX file: $@"
\t\$(TIARMHEX) --diag_wrap=off --intel --memwidth 8 --romwidth 8 -o "$@" "$<"

# Generate ELF file for debugging
\$(OUTPUT_DIR)/\$(PROJECT_NAME).elf: \$(OUTPUT_DIR)/\$(PROJECT_NAME).out
\t@echo "Generating ELF file: $@"
\t\$(TIARMOBJCOPY) -O elf32-littlearm "$<" "$@"

# Generate disassembly
\$(OUTPUT_DIR)/full_disasm.txt: \$(OUTPUT_DIR)/\$(PROJECT_NAME).out
\t@echo "Generating disassembly: $@"
\t\$(TIARMOBJDUMP) -ls "$<" > "$@"

# Clean build artifacts
clean:
\t@echo "Cleaning build artifacts..."
\t-\$(RM) \$(OBJECTS) \$(OUTPUT_DIR)/\$(PROJECT_NAME).out \$(OUTPUT_DIR)/\$(PROJECT_NAME).hex \$(OUTPUT_DIR)/\$(PROJECT_NAME).elf
\t-\$(RM) \$(OUTPUT_DIR)/\$(PROJECT_NAME).map \$(OUTPUT_DIR)/\$(PROJECT_NAME)_linkInfo.xml
\t-\$(RM) \$(OUTPUT_DIR)/*.d
\t@echo "Clean complete"

# Include dependency files
-include \$(OBJECTS:.o=.d)
`;

        fs.writeFileSync(makefilePath, content, 'utf8');
    }

    private static generateCompilerMk(config: MakefileConfig): void {
        const mkPath = path.join(config.outputPath, 'compiler.mk');

        const binDir = path.dirname(config.compilerPath);
        const platform = os.platform();
        const exe = platform === 'win32' ? '.exe' : '';

        // Convert paths to use forward slashes for make compatibility
        const normalizePath = (p: string) => p.replace(/\\/g, '/');

        // Add CMSIS Core include path
        const cmsisCorePath = path.join(config.sdkPath, 'source', 'third_party', 'CMSIS', 'Core', 'Include');

        const content = `# Compiler Configuration
# Generated: ${new Date().toISOString()}

# Toolchain paths
CC := ${normalizePath(path.join(binDir, `tiarmclang${exe}`))}
TIARMHEX := ${normalizePath(path.join(binDir, `tiarmhex${exe}`))}
TIARMOBJCOPY := ${normalizePath(path.join(binDir, `tiarmobjcopy${exe}`))}
TIARMOBJDUMP := ${normalizePath(path.join(binDir, `tiarmobjdump${exe}`))}

# Compiler flags - ARM Cortex-M0+ specific
CFLAGS := -march=thumbv6m
CFLAGS += -mcpu=cortex-m0plus
CFLAGS += -mfloat-abi=soft
CFLAGS += -mlittle-endian
CFLAGS += -mthumb

# Optimization and debug settings
${config.optimization === 'debug' ? `CFLAGS += -O0
CFLAGS += -g
CFLAGS += -gdwarf-3` : `CFLAGS += -O2`}

# Device defines
CFLAGS += -D__MSPM0G3507__
CFLAGS += -DTARGET_IS_MSPM0G3507

# Include paths - CMSIS FIRST (critical for core_cm0plus.h)
CFLAGS += -I"${normalizePath(cmsisCorePath)}"
${config.includePaths.map(p => `CFLAGS += -I"${normalizePath(p)}"`).join('\n')}
CFLAGS += -I"${normalizePath(path.join(config.projectPath, 'syscfg'))}"

# Compiler options
CFLAGS += -MMD
CFLAGS += -MP
CFLAGS += -Wall
CFLAGS += -Wextra
CFLAGS += -Wno-unused-parameter
CFLAGS += -Wno-sign-compare
CFLAGS += -std=c99

# Platform-specific flags
${platform === 'win32' ? 'CFLAGS += -fdiagnostics-format=msvc' : 'CFLAGS += -fdiagnostics-format=clang'}
`;

        fs.writeFileSync(mkPath, content, 'utf8');
    }

    private static generateSourcesMk(config: MakefileConfig): void {
        const mkPath = path.join(config.outputPath, 'sources.mk');

        // Normalize paths for make and escape spaces
        const normalizePath = (p: string) => p.replace(/\\/g, '/');
        const escapePath = (p: string) => p.replace(/ /g, '\\ ');
        const makeRelative = (p: string) => {
            const rel = path.relative(config.outputPath, p);
            return normalizePath(rel);
        };

        // Generate object file names - just use the base filename
        const objects = config.sourceFiles.map(srcFile => {
            const baseName = path.basename(srcFile, path.extname(srcFile));
            return `${baseName}.o`;
        });

        const content = `# Source Files Configuration
# Generated: ${new Date().toISOString()}

# Source files (paths with spaces are escaped)
SOURCES := \\
${config.sourceFiles.map(f => `\t${escapePath(normalizePath(f))}`).join(' \\\n')}

# Object files
OBJECTS := \\
${objects.map(o => `\t${o}`).join(' \\\n')}

# Compilation rules
${config.sourceFiles.map((srcFile, idx) => {
    const objFile = objects[idx];
    const normalizedSrc = escapePath(normalizePath(srcFile));
    return `${objFile}: ${normalizedSrc}
\t@echo "Building file: $<"
\t\$(CC) \$(CFLAGS) -c "$<" -o "$@"`;
}).join('\n\n')}
`;

        fs.writeFileSync(mkPath, content, 'utf8');
    }

    private static generateLinkerMk(config: MakefileConfig): void {
        const mkPath = path.join(config.outputPath, 'linker.mk');

        const normalizePath = (p: string) => p.replace(/\\/g, '/');
        const escapePath = (p: string) => p.replace(/ /g, '\\ ');

        // Find linker script
        const linkerScript = path.join(config.projectPath, 'syscfg', 'device_linker.cmd');
        const hasLinkerScript = fs.existsSync(linkerScript);

        // Find driverlib
        const driverlibDir = path.join(config.sdkPath, 'source', 'ti', 'driverlib', 'lib', 'ticlang', 'm0p', 'mspm0g1x0x_g3x0x');
        const hasDriverlib = fs.existsSync(driverlibDir);

        const content = `# Linker Configuration
# Generated: ${new Date().toISOString()}

# Linker flags
LDFLAGS := -Wl,--diag_wrap=off
LDFLAGS += -Wl,--display_error_number
LDFLAGS += -Wl,--warn_sections
LDFLAGS += -Wl,--xml_link_info=${config.entryPointBaseName}_linkInfo.xml
LDFLAGS += -Wl,--rom_model
LDFLAGS += -Wl,-m${config.entryPointBaseName}.map

# Library paths
${config.libraryPaths.map(p => `LDFLAGS += -L"${normalizePath(p)}"`).join('\n')}
${hasDriverlib ? `LDFLAGS += -L"${normalizePath(driverlibDir)}"` : ''}

# Linker script (paths with spaces are escaped)
${hasLinkerScript ? `LDFLAGS += -Wl,-l${escapePath(normalizePath(linkerScript))}` : ''}

# Libraries
LIBS := -Wl,-llibc.a
${hasDriverlib ? `LIBS += -Wl,--library=driverlib.a` : ''}

# Additional linker files
${fs.existsSync(path.join(config.projectPath, 'syscfg', 'device.cmd.genlibs')) ?
`LDFLAGS += -Wl,-l${escapePath(normalizePath(path.join(config.projectPath, 'syscfg', 'device.cmd.genlibs')))}` : ''}
`;

        fs.writeFileSync(mkPath, content, 'utf8');
    }
}
