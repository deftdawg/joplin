import Setting from '@joplin/lib/models/Setting';
import { FolderEntity, NoteEntity, TagEntity } from '@joplin/lib/services/database/types';
import { _ } from '@joplin/lib/locale';
import { ALL_NOTES_FILTER_ID } from '@joplin/lib/reserved-ids';

interface RenderWindowTitleArgs {
    templateString: string;
    currentNote?: NoteEntity | null;
    currentFolder?: FolderEntity | null;
    selectedTag?: TagEntity | null;
    searchQuery?: string | null;
    allFolders?: FolderEntity[] | null;
}

export function renderWindowTitle(args: RenderWindowTitleArgs): string {
    const {
        templateString,
        currentNote,
        currentFolder,
        selectedTag,
        searchQuery,
        allFolders,
    } = args;

    if (!templateString) {
        return 'Joplin'; // Default title if template is somehow empty
    }

    let title = templateString;

    const noteTitle = currentNote?.title?.trim() || (currentNote ? _('Untitled') : '');
    const folderTitle = currentFolder?.title?.trim() || ''; // This is the selected folder's title
    const tagTitle = selectedTag?.title?.trim() || '';
    const currentSearchQuery = searchQuery || '';
    const profileIdentifier = Setting.value('profileDir') || '';

    // --- Subnotebook Logic ---
    let topLevelNotebookTitle = '';
    let subnotebookParts: string[] = [];

    if (currentFolder) {
        if (currentFolder.id === ALL_NOTES_FILTER_ID) {
            topLevelNotebookTitle = folderTitle; // Which is _('All Notes')
        } else if (currentFolder.parent_id && allFolders) {
            let parent = allFolders.find(f => f.id === currentFolder.parent_id);
            const pathBuilder: string[] = [];
            let safety = 0;
            while (parent && safety < 10) {
                pathBuilder.unshift(parent.title.trim());
                if (!parent.parent_id) {
                    topLevelNotebookTitle = parent.title.trim();
                    break;
                }
                parent = allFolders.find(f => f.id === parent.parent_id);
                safety++;
            }

            if (!topLevelNotebookTitle && pathBuilder.length > 0) {
                // This case can happen if the direct parent is top-level
                topLevelNotebookTitle = pathBuilder[0];
            }
            
            // If currentFolder itself is not topLevelNotebookTitle, then pathBuilder contains its ancestors
            // up to (but not including) topLevelNotebookTitle.
            // And folderTitle is the current selected folder.
            // Subnotebook parts should be the path from topLevelNotebookTitle's direct child down to folderTitle's direct parent.
            if (folderTitle !== topLevelNotebookTitle) {
                subnotebookParts = pathBuilder.filter(p => p !== topLevelNotebookTitle);
                // Now, if currentFolder itself is a sub-notebook (not the one holding the note, but selected),
                // its title should be part of the subnotebook string.
                // The current folderTitle is the "leaf" of the folder hierarchy being displayed.
                // If Notebook = A, Subnotebook = B, Note in C (child of B).
                // If currentFolder is C, then folderTitle = C. pathBuilder was [A, B]. topLevel=A. subnotebookParts=[B]. Correct.
                // If currentFolder is B, then folderTitle = B. pathBuilder was [A]. topLevel=A. subnotebookParts=[]. Correct.
            }
        } else { // currentFolder has no parent_id, so it's a top-level notebook itself.
            topLevelNotebookTitle = folderTitle;
        }
    }
    // If currentFolder is null (e.g. Smart Filter or global search without folder context),
    // topLevelNotebookTitle and subnotebookParts remain empty.

    const subnotebookString = subnotebookParts.join(' - ');

    const hasNote = !!noteTitle;
    const hasNotebook = !!topLevelNotebookTitle;
    const hasSubnotebook = !!subnotebookString;
    const hasTag = !!tagTitle;
    const hasSearch = !!currentSearchQuery;
    const hasProfile = !!profileIdentifier;

    const placeholderDefData = [
        { name: 'Notebook', value: topLevelNotebookTitle, hasValue: hasNotebook, defaultSeparator: ' - ' },
        { name: 'Subnotebook', value: subnotebookString, hasValue: hasSubnotebook, defaultSeparator: ' - ' },
        { name: 'Search', value: currentSearchQuery, hasValue: hasSearch, defaultSeparator: ' - ' },
        { name: 'Tag', value: tagTitle, hasValue: hasTag, defaultSeparator: ' - ' },
        { name: 'Note', value: noteTitle, hasValue: hasNote, defaultSeparator: ' - ' },
        { name: 'Profile', value: profileIdentifier, hasValue: hasProfile, defaultSeparator: ' - ' },
    ];

    interface Token {
        type: 'literal' | 'placeholder';
        value: string; // For literal: the string itself. For placeholder: its name e.g. "Notebook"
        placeholderDef?: (typeof placeholderDefData)[0]; // Reference to placeholder data
        definedSeparator?: string | null; // Separator defined in template, e.g. " :: "
        rendered: boolean; // True if this token resulted in output. Initialized to false for placeholders.
    }

    const tokens: Token[] = [];
    // Regex: group 1&2&3 for bracketed separator, group 4 for placeholder with bracketed separator
    // OR group 5 for placeholder without bracketed separator.
    // 1: (
    // 2: separator content like " - " or " :: "
    // 3: )
    // 4: placeholder like ${Notebook} that was preceded by bracketed separator
    // 5: placeholder like ${Note} that was NOT preceded by bracketed separator
    const placeholderRegex = /(\()([^)]*)(\))\s*(\$\{[A-Za-z]+\})|(\$\{[A-Za-z]+\})/g;
    let lastIndex = 0;
    let match;

    while ((match = placeholderRegex.exec(templateString)) !== null) {
        const literalPart = templateString.substring(lastIndex, match.index);
        if (literalPart) {
            tokens.push({ type: 'literal', value: literalPart, rendered: true }); // Literals are 'rendered' by default
        }

        const placeholderNameWithBraces = match[4] || match[5]; // ${Placeholder}
        const placeholderName = placeholderNameWithBraces.substring(2, placeholderNameWithBraces.length - 1);
        const def = placeholderDefData.find(p => p.name === placeholderName);

        if (def) {
            tokens.push({
                type: 'placeholder',
                value: placeholderName, // Just the name like "Notebook"
                placeholderDef: def,
                definedSeparator: match[2] !== undefined ? match[2] : null, // Content of ($separator)
                rendered: false, // Initialize rendered to false for placeholders
            });
        }
        lastIndex = match.index + match[0].length;
    }

    // Add any remaining literal part after the last match
    if (lastIndex < templateString.length) {
        tokens.push({ type: 'literal', value: templateString.substring(lastIndex), rendered: true });
    }

    // --- Rendering Pass (Strictly as per Turn 33, Step 1 instructions) ---
    let result = "";
    let lastMeaningfulContentRendered = false;

    for (let i = 0; i < tokens.length; i++) {
        const P_i = tokens[i];

        if (P_i.type === 'literal') {
            result += P_i.value; // Append P_i.value to result.
            if (P_i.value.trim() !== "") { // If P_i.value.trim() !== ""
                lastMeaningfulContentRendered = true; // Set lastMeaningfulContentRendered = true.
            }
            // Else (P_i.value is only whitespace), lastMeaningfulContentRendered remains unchanged.
        } else if (P_i.type === 'placeholder') {
            // If !P_i.placeholderDef.hasValue
            if (!P_i.placeholderDef || !P_i.placeholderDef.hasValue) {
                P_i.rendered = false; // Set P_i.rendered = false
                continue; // Continue to next token
            }
            // Set P_i.rendered = true.
            P_i.rendered = true;

            // actualSeparatorToUse = null;
            let actualSeparatorToUse: string | null = null;

            // If P_i.definedSeparator is not null and not undefined:
            if (P_i.definedSeparator != null) { // Using != null to catch both null and undefined
                actualSeparatorToUse = P_i.definedSeparator; // actualSeparatorToUse = P_i.definedSeparator;
            } else {
                // Else (no explicit separator for P_i):
                // Iterate backwards from k = i - 1 down to 0.
                for (let k = i - 1; k >= 0; k--) {
                    const prevToken = tokens[k];
                    // If tokens[k].type === 'placeholder' AND !tokens[k].rendered AND tokens[k].definedSeparator (is not null and not undefined):
                    if (prevToken.type === 'placeholder' && prevToken.rendered === false && prevToken.definedSeparator != null) {
                        actualSeparatorToUse = prevToken.definedSeparator; // actualSeparatorToUse = tokens[k].definedSeparator;
                        break; // Break this inner backward loop.
                    }
                    // No other break conditions specified for this inner loop in the prompt for this step.
                }
            }

            // If actualSeparatorToUse is still null AND lastMeaningfulContentRendered is true:
            if (actualSeparatorToUse === null && lastMeaningfulContentRendered === true) {
                actualSeparatorToUse = P_i.placeholderDef.defaultSeparator; // actualSeparatorToUse = P_i.placeholderDef.defaultSeparator;
            }

            // If actualSeparatorToUse is not null AND lastMeaningfulContentRendered is true:
            if (actualSeparatorToUse != null && lastMeaningfulContentRendered === true) {
                result += actualSeparatorToUse; // Append actualSeparatorToUse to result.
            }
            
            // Append P_i.placeholderDef.value to result.
            result += P_i.placeholderDef.value;
            // Set lastMeaningfulContentRendered = true.
            lastMeaningfulContentRendered = true;
        }
    }

    // Step 3: Final Cleanup
    result = result.replace(/\s\s+/g, ' ').trim();

    if (result === "") {
        return 'Joplin'; // Default to "Joplin" if everything was omitted
    }

    return result;
}
