const fs = require('fs');
const path = 'src/SplitTool.ts';
try {
    const content = fs.readFileSync(path, 'utf8');
    const lines = content.split(/\r?\n/);

    const startMarker = '    // Helper to update a plate\'s rift connections';
    // We need to be careful with the end marker. It's just a closure.
    // Let's find the start, then count braces to find the end of the function?
    // Or just look for the indentation level.

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(startMarker)) {
            startIndex = i;
            break;
        }
    }

    if (startIndex !== -1) {
        // Find the matching closing brace for the function at line startIndex + 1
        // The function starts at startIndex + 1: "    const updatePlateRiftConnections = ..."
        // We can just iterate until we find the closing brace at the same indentation level.
        // Or we can just look for the known end line context if we trust it hasn't moved much.
        // Let's use a simpler approach: look for the closing brace of the function.
        // The function started with 4 spaces indentation.
        // Expecting end at "    };"

        for (let i = startIndex + 1; i < lines.length; i++) {
            if (lines[i] === '    };') {
                endIndex = i;
                break;
            }
        }
    }

    if (startIndex !== -1 && endIndex !== -1) {
        console.log(`Removing lines ${startIndex} to ${endIndex}`);
        lines.splice(startIndex, endIndex - startIndex + 1);
        fs.writeFileSync(path, lines.join('\n'));
        console.log('File updated successfully.');
    } else {
        console.log('Could not find start or end markers.');
        console.log('Start:', startIndex, 'End:', endIndex);
    }
} catch (e) {
    console.error('Error:', e);
}
