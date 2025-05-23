import * as React from 'react';
import { connect } from 'react-redux';
import Setting from '@joplin/lib/models/Setting';
import { AppState, AppStateRoute, NoteEntity, FolderEntity, TagEntity } from '../app.reducer';
import bridge from '../services/bridge';
import { useContext, useEffect, useMemo, useRef } from 'react';
import { WindowIdContext } from './NewWindowOrIFrame';
import { renderWindowTitle } from './windowTitleUtils';
import { ALL_NOTES_FILTER_ID } from '@joplin/lib/reserved-ids';
import { _ } from '@joplin/lib/locale';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Partial refactor of code from before rule was applied
type ScreenProps = any;

interface AppScreen {
	screen: React.ComponentType<ScreenProps>;
	title?: ()=> string;
}

interface Props {
	route: AppStateRoute;
	screens: Record<string, AppScreen>;
	style: React.CSSProperties;
	className?: string;
	searchQuery?: string;
	selectedTagId?: string;
	allTags?: TagEntity[];
	allFolders?: FolderEntity[];
	selectedFolderId?: string;
	currentNote?: NoteEntity;
	currentFolder?: FolderEntity;
}

const useWindowTitleManager = (screenInfo: AppScreen, props: Props) => {
	const windowId = useContext(WindowIdContext);

	useEffect(() => {
		const titleTemplate = Setting.value('window.title.template');
		const devMarker = Setting.value('env') === 'dev' ? ` (DEV - ${Setting.value('profileDir')})` : '';
		let finalWindowTitle = '';

		if (screenInfo?.title) {
			finalWindowTitle = [screenInfo.title(), `Joplin${devMarker}`].join(' - ');
		} else {
			const isAllNotes = props.selectedFolderId === ALL_NOTES_FILTER_ID;
			const currentFolderForTitle = isAllNotes ? 
				{ title: _('All Notes'), id: ALL_NOTES_FILTER_ID, parent_id: null } as FolderEntity : 
				props.currentFolder;

			const RENDER_ARGS = {
				templateString: titleTemplate,
				currentNote: props.currentNote,
				currentFolder: currentFolderForTitle,
				selectedTag: props.allTags?.find(t => t.id === props.selectedTagId),
				searchQuery: props.searchQuery,
				allFolders: props.allFolders,
			};

			let newTitle = renderWindowTitle(RENDER_ARGS);

			// Append devMarker ensuring Joplin is part of it
			if (devMarker) {
				if (newTitle.includes('Joplin')) {
					newTitle = newTitle.replace('Joplin', `Joplin${devMarker}`);
				} else {
					newTitle = `${newTitle}${newTitle ? ' - ' : ''}Joplin${devMarker}`;
				}
			}
			finalWindowTitle = newTitle;
		}

		bridge().windowById(windowId)?.setTitle(finalWindowTitle);
	}, [
		screenInfo, 
		props.currentNote, 
		props.currentFolder, 
		props.selectedTagId, 
		props.searchQuery, 
		props.allTags, 
		props.allFolders,
		props.selectedFolderId,
		windowId,
	]);
};

const useWindowRefocusManager = (route: AppStateRoute) => {
	const windowId = useContext(WindowIdContext);

	const prevRouteName = useRef<string|null>(null);
	const routeName = route?.routeName;
	useEffect(() => {
		// When a navigation happens in an unfocused window, show the window to the user.
		// This might happen if, for example, a secondary window triggers a navigation in
		// the main window.
		if (routeName && routeName !== prevRouteName.current) {
			bridge().switchToWindow(windowId);
		}

		prevRouteName.current = routeName;
	}, [routeName, windowId]);
};

const NavigatorComponent: React.FC<Props> = props => {
	const route = props.route;
	const screenInfo = props.screens[route?.routeName];

	useWindowTitleManager(screenInfo, props);
	useWindowRefocusManager(route);

	if (!route) throw new Error('Route must not be null');

	const screenProps = route.props ? route.props : {};
	const Screen = screenInfo.screen;

	const screenStyle = {
		width: props.style.width,
		height: props.style.height,
	};

	return (
		<div style={props.style} className={props.className}>
			<Screen style={screenStyle} {...screenProps} />
		</div>
	);
};

const Navigator = connect((state: AppState) => {
	return {
		route: state.route,
		searchQuery: state.searchQuery,
		selectedTagId: state.selectedTagId,
		allTags: state.tags,
		allFolders: state.folders,
		selectedFolderId: state.selectedFolderId,
		// currentNote and currentFolder are often derived or part of `route.props` or specific views,
		// but if they are globally available in top-level state, map them.
		// Assuming they are passed via route.props or available through existing mechanisms
		// For now, let's rely on them being passed via props if needed by renderWindowTitle,
		// or that they are already part of the `props` due to existing `connect` logic if they were top-level.
		// The `RENDER_ARGS` in `useWindowTitleManager` will use `props.currentNote` and `props.currentFolder`
		// which are already part of the Props interface if they were mapped by a higher-order component or passed directly.
		// Let's ensure they are explicitly in Props if not already.
		// From the original text: "currentNote: currentNote (already there)", "currentFolder: currentFolder (already there)"
		// This implies they are already part of the state mapping or route props.
		// Adding them to Props interface if they are expected from state directly:
		currentNote: state.selectedNoteIds && state.selectedNoteIds.length === 1 ? state.notes.find((n:NoteEntity) => n.id === state.selectedNoteIds[0]) : null,
		currentFolder: state.selectedFolderId ? state.folders.find((f:FolderEntity) => f.id === state.selectedFolderId) : null,
	};
})(NavigatorComponent);

export default Navigator;
