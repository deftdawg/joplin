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

    const subnotebookString = subnotebookParts.join(' - '); // Using " - " as a common separator

    const placeholders = [
        { name: 'Notebook', value: topLevelNotebookTitle, omitIfEmpty: true },
        { name: 'Subnotebook', value: subnotebookString, omitIfEmpty: true },
        { name: 'Search', value: currentSearchQuery, omitIfEmpty: true },
        { name: 'Tag', value: tagTitle, omitIfEmpty: true },
        { name: 'Note', value: noteTitle, omitIfEmpty: true },
        { name: 'Profile', value: profileIdentifier, omitIfEmpty: false },
    ];

    for (const p of placeholders) {
        // Regex to find placeholder and optional surrounding non-alphanumeric/non-space chars and spaces
        // Example: ( - )${Note} or ${Note} :: or just ${Note}
        // This regex attempts to capture common separator patterns.
        // Group 1: Prefix (optional, non-word chars except '{', with spaces)
        // Group 2: Placeholder itself
        // Group 3: Suffix (optional, non-word chars except '}', with spaces)
        const placeholderRegex = new RegExp(
            // Optional prefix: spaces, then non-word chars (but not '{'), then spaces
            `(\\s*[^\w\\s\\{\\}]*\\s*)?` +
            // The placeholder itself
            `(\\$\\{${p.name}\\})` +
            // Optional suffix: spaces, then non-word chars (but not '}'), then spaces
            `(\\s*[^\w\\s\\{\\}]*\\s*)?`,
            'g'
        );

        let lastIndex = 0;
        const newTitleParts: string[] = [];
        let match;

        while ((match = placeholderRegex.exec(title)) !== null) {
            newTitleParts.push(title.substring(lastIndex, match.index)); // Add text before match

            const prefix = match[1] || '';
            const placeholderFound = match[2]; // Should always be the placeholder like ${Note}
            const suffix = match[3] || '';

            if (p.value) {
                newTitleParts.push(prefix + p.value + suffix);
            } else if (p.omitIfEmpty) {
                // If value is empty and omitIfEmpty is true, we omit everything: prefix, placeholder, suffix.
                // However, we need to be careful not to remove "Joplin" or other fixed parts of the template.
                // This regex approach might be too aggressive if "Joplin" is part of prefix/suffix.
                // A simpler strategy might be better: first replace placeholders, then clean up.
                // For now, let's stick to removing the captured segment.
                newTitleParts.push('');
            } else {
                // If omitIfEmpty is false (like for Profile), or if we decide to keep separators for empty optional fields,
                // we'd push something here. For now, if no value, and not omitting, effectively removes placeholder.
                newTitleParts.push('');
            }
            lastIndex = placeholderRegex.lastIndex;
        }
        newTitleParts.push(title.substring(lastIndex)); // Add remaining text
        title = newTitleParts.join('');

        // Fallback: if the complex regex didn't catch it (e.g. placeholder without clear separators),
        // do a simple replacement. This helps if the template is just "${Note}"
        if (p.value || p.omitIfEmpty) { // If there's a value, or if it's empty and should be omitted
            title = title.replace(`\${${p.name}}`, p.value || '');
        }
    }

    // --- Post-processing and Cleanup ---

    // Specific cleanup for "All Notes - Joplin" if note is empty (and not a search/tag view)
    if (currentFolder && currentFolder.id === ALL_NOTES_FILTER_ID && !noteTitle && !tagTitle && !searchQuery) {
        const allNotesStr = _('All Notes');
        // If title became "All Notes - " or "All Notes :: " due to empty note, clean it
        title = title.replace(new RegExp(`^${allNotesStr}\\s*[^\\w\\s]*\\s*(Joplin|$)`, 'i'), `${allNotesStr} $1`).trim();
        if (title.endsWith(allNotesStr)) title = allNotesStr; // If it's just "All Notes"
    }
    
    // Remove dangling separators if a section is empty.
    // Example: "Value1 - - Value3" becomes "Value1 - Value3"
    // Or " - Value2" becomes "Value2", or "Value1 - " becomes "Value1"
    // This regex looks for a separator surrounded by spaces, where one side might be empty or another separator.
    // Matches " SEPARATOR SEPARATOR " or " SEPARATOR at start/end "
    const commonSeparators = ['-', ':', '/', '>', '\\|']; // Common separators to look for
    const sepPattern = `(?:${commonSeparators.map(s => `\\${s}`).join('|')})`;

    // Remove duplicate separators: "A - - B" -> "A - B"
    title = title.replace(new RegExp(`(\\s${sepPattern}\\s)+`, 'g'), ` $1 `); // $1 here is the last matched separator in the group

    // Remove leading separators: " - A" -> "A" (unless it's the only content)
    title = title.replace(new RegExp(`^\\s*${sepPattern}\\s+`, ''), '');

    // Remove trailing separators: "A - " -> "A" (unless it's the only content)
    title = title.replace(new RegExp(`\\s+${sepPattern}\\s*$`, ''), '');
    
    // Collapse multiple spaces to one
    title = title.replace(/\s{2,}/g, ' ');
    title = title.trim();

    // If the title ended up being just a separator (or empty), default to "Joplin"
    if (title === '' || new RegExp(`^${sepPattern}$`).test(title)) {
        return 'Joplin';
    }

    return title || 'Joplin'; // Ensure non-empty or default
}
