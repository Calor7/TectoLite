const fs = require('fs');
const path = 'src/SplitTool.ts';
const content = fs.readFileSync(path, 'utf8');
const lines = content.split(/\r?\n/);

const startMarker = '    // Helper to update a plate\'s rift connections';
const endMarker = '    };';

let startIndex = -1;
let endIndex = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(startMarker) && startIndex === -1) {
        startIndex = i;
    }
    // We look for the end marker specifically after the start marker and roughly where we expect it
    // The end marker is just "    };" which is common.
    // We want the one that closes the function.
    // In the file view, it was around line 956.
    // The function started around 932.
    // So let's look for "    };" after start index.
    if (startIndex !== -1 && i > startIndex && lines[i].trim() === '};') {
        // There might be nested braces.
        // Let's assume the indentation matches "    };" (4 spaces).
        if (lines[i] === '    };') {
            endIndex = i;
            // We found the first closing brace at root indentation level after start.
            // This corresponds to the end of the function.
            // Check context: line 956 in previous view.
            console.log(`Found candidate end at ${i}: ${lines[i]}`);
            // Let's verify it's the right one by checking a few lines before?
            // No, let's just take the first '    };' after start.
            break;
        }
    }
}

if (startIndex !== -1 && endIndex !== -1) {
    console.log(`Removing lines ${startIndex} to ${endIndex}`);
    console.log('Start line content:', lines[startIndex]);
    console.log('End line content:', lines[endIndex]);

    // Remove the lines
    lines.splice(startIndex, endIndex - startIndex + 1);

    fs.writeFileSync(path, lines.join('\n'));
    console.log('File updated.');
} else {
    console.log('Markers not found.');
    console.log('Start Index:', startIndex);
}
