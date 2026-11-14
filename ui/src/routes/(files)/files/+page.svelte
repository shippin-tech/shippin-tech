<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import DriveView from '$lib/catalog/file/File.svelte';
	import Lesson from '$lib/catalog/mcpl/Lesson.svelte';
	import { account } from '$lib/adapter/session';
	import { pushLessonProgress } from '$lib/adapter/learn';
	import {
		breadcrumbs,
		ROOT_NAME,
		createFolder,
		downloadNode,
		findPerson,
		listFolder,
		listFolders,
		listSharedDrives,
		listSharedWithMe,
		loadShares,
		loadUsage,
		moveNode,
		removeNode,
		renameNode,
		saveShares,
		searchDrive,
		uploadFile,
		type DriveCrumb,
		type DriveNode,
		type DriveShare,
		type DriveUsage,
		type UploadState
	} from '$lib/adapter/drive';
	import { isDocName } from '$lib/adapter/docs-call';
	import GoogleDrive from '$lib/catalog/google/GoogleDrive.svelte';
	import {
		connectGoogle,
		copyToGoogle,
		disconnectGoogle,
		downloadGoogle,
		googleStatus,
		importFromGoogle,
		isFolder,
		listGoogle,
		type GoogleFile,
		type GoogleStatus
	} from '$lib/adapter/google';
	import { mcplEmit } from '$lib/mcpl/events';
	import { LESSONS, lessonsChanged, loadProgress, saveProgress } from '$lib/mcpl/lessons';

	const lesson = LESSONS.find((item) => item.id === 'use-your-drive')!;
	const googleLesson = LESSONS.find((item) => item.id === 'link-google-drive')!;
	const who = account()?.username ?? '';

	let items = $state<DriveNode[]>([]);
	let folders = $state<Map<string, DriveNode>>(new Map());
	let usage = $state<DriveUsage | null>(null);
	let uploads = $state<UploadState[]>([]);
	let notice = $state('Loading files.');
	let problem = $state('');
	let search = $state('');
	let progress = $state(loadProgress(who, lesson));
	let googleProgress = $state(loadProgress(who, googleLesson));
	let google = $state<GoogleStatus | null>(null);
	let googleNotice = $state('');
	let googleProblem = $state('');
	let googleDone = $state('');
	let googleFiles = $state<GoogleFile[]>([]);
	let googlePath = $state<{ id: string; name: string }[]>([]);
	let googleSection = $state<'mine' | 'shared'>('mine');
	let googleSearch = $state('');
	let googleNext = $state<string | null>(null);
	let googleBusy = $state<Set<string>>(new Set());
	let uploadCount = 0;

	const SHARED_ROOT: DriveCrumb = { id: null, name: 'Shared with me' };

	const folder = $derived(page.url.searchParams.get('folder'));
	/** The other person's Drive being browsed, if any. */
	const drive = $derived(page.url.searchParams.get('drive') ?? undefined);
	const sharedRoot = $derived(page.url.searchParams.get('view') === 'shared' && !drive);
	const scope = $derived<'mine' | 'shared'>(sharedRoot || drive ? 'shared' : 'mine');
	const crumbs = $derived(
		sharedRoot ? [SHARED_ROOT] : breadcrumbs(folder, folders, drive ? SHARED_ROOT : { id: null, name: ROOT_NAME })
	);
	const onGoogle = $derived(page.url.searchParams.get('view') === 'google');
	const canAdd = $derived(scope === 'mine' || (!!folder && folders.get(folder)?.rights.add === true));

	$effect(() => {
		$lessonsChanged;
		progress = loadProgress(who, lesson);
		googleProgress = loadProgress(who, googleLesson);
	});

	function dismissGoogleLesson() {
		googleProgress = { ...googleProgress, dismissed: true };
		saveProgress(who, googleLesson, googleProgress);
		void pushLessonProgress(googleLesson.id, googleProgress);
	}

	function dismissLesson() {
		progress = { ...progress, dismissed: true };
		saveProgress(who, lesson, progress);
		void pushLessonProgress(lesson.id, progress);
	}

	function message(err: unknown, fallback: string): string {
		return err instanceof Error ? err.message : fallback;
	}

	let loadId = 0;

	async function listShared(): Promise<DriveNode[]> {
		const drives = await listSharedDrives();
		return (await Promise.all(drives.map(listSharedWithMe))).flat();
	}

	async function refresh(where: string | null, text: string) {
		const id = ++loadId;
		const inDrive = drive;
		try {
			const [listed, allFolders, used] = await Promise.all([
				sharedRoot ? listShared() : text.trim() ? searchDrive(text, inDrive) : listFolder(where, inDrive),
				sharedRoot ? Promise.resolve([] as DriveNode[]) : listFolders(inDrive),
				inDrive || sharedRoot ? Promise.resolve(null) : loadUsage().catch(() => null)
			]);
			if (id !== loadId) return;
			items = listed;
			folders = new Map(allFolders.map((node) => [node.id, node]));
			usage = used;
			notice = '';
		} catch (err) {
			if (id !== loadId) return;
			notice = message(err, 'Files could not be loaded.');
		}
	}

	$effect(() => {
		if (onGoogle) return;
		void drive;
		void sharedRoot;
		void refresh(folder, search);
	});

	async function loadGoogleStatus() {
		try {
			google = await googleStatus();
		} catch (err) {
			googleNotice = message(err, 'The Google link could not be checked.');
		}
	}

	async function loadGoogleFiles(page_?: string) {
		if (!google?.connected) return;
		googleProblem = '';
		const parent = googlePath.at(-1)?.id;
		try {
			const listing = await listGoogle({
				folder: parent,
				search: googleSearch,
				shared: googleSection === 'shared' && !parent,
				page: page_
			});
			googleFiles = page_ ? [...googleFiles, ...listing.files] : listing.files;
			googleNext = listing.nextPage;
		} catch (err) {
			googleProblem = message(err, 'Your Google files could not be loaded.');
			await loadGoogleStatus();
		}
	}

	$effect(() => {
		void loadGoogleStatus();
	});

	$effect(() => {
		if (!onGoogle || !google?.connected) return;
		void googleSection;
		void googleSearch;
		void googlePath;
		void loadGoogleFiles();
	});

	/** Google sent the person back: say how it went, then tidy the address. */
	$effect(() => {
		if (!onGoogle) return;
		const params = page.url.searchParams;
		if (params.get('connected') === '1') {
			mcplEmit('google.account.connected', 'google');
			void loadGoogleStatus();
			void goto('/files?view=google', { replaceState: true });
		} else if (params.get('failed') === '1') {
			googleProblem = 'Google did not finish connecting. Try again.';
			void goto('/files?view=google', { replaceState: true });
		}
	});

	async function connect() {
		googleProblem = '';
		try {
			await connectGoogle();
		} catch (err) {
			googleProblem = message(err, 'Google could not be reached.');
		}
	}

	async function disconnect() {
		googleProblem = '';
		try {
			await disconnectGoogle();
			mcplEmit('google.account.disconnected', 'google');
			googleFiles = [];
			googlePath = [];
			await loadGoogleStatus();
		} catch (err) {
			googleProblem = message(err, 'The link could not be removed.');
		}
	}

	async function bringOver(file: GoogleFile, format?: string) {
		googleProblem = '';
		googleDone = '';
		googleBusy = new Set(googleBusy).add(file.id);
		try {
			await importFromGoogle(file, format);
			googleDone = `${file.name} was copied to your Drive.`;
			mcplEmit('google.file.imported', 'google');
		} catch (err) {
			googleProblem = message(err, `${file.name} could not be copied.`);
		}
		const next = new Set(googleBusy);
		next.delete(file.id);
		googleBusy = next;
	}

	async function fetchFromGoogle(file: GoogleFile, format?: string) {
		googleProblem = '';
		try {
			await downloadGoogle(file, format);
		} catch (err) {
			googleProblem = message(err, `${file.name} could not be downloaded.`);
		}
	}

	async function sendToGoogle(node: DriveNode) {
		problem = '';
		try {
			await copyToGoogle(node);
			mcplEmit('google.file.exported', 'google');
			problem = `${node.name} was copied to your Google Drive.`;
		} catch (err) {
			problem = message(err, `${node.name} could not be copied to Google.`);
		}
	}

	function open(target: DriveCrumb | DriveNode) {
		problem = '';
		search = '';
		const inDrive = 'drive' in target && target.drive ? target.drive : drive;
		if (!target.id) {
			void goto(inDrive ? '/files?view=shared' : '/files');
			return;
		}
		const params = new URLSearchParams({ folder: target.id });
		if (inDrive) params.set('drive', inDrive);
		void goto(`/files?${params.toString()}`);
	}

	function accountOf(node: DriveNode): string | undefined {
		return node.drive ?? drive;
	}

	/** Runs one change; afterwards the list always shows what the server has. */
	async function run(action: () => Promise<void>, fallback: string, after?: () => void): Promise<boolean> {
		problem = '';
		try {
			await action();
			after?.();
			await refresh(folder, search);
			return true;
		} catch (err) {
			problem = message(err, fallback);
			return false;
		}
	}

	async function upload(files: File[]) {
		problem = '';
		const target = folder;
		const inDrive = drive;
		const queued = files.map((file) => ({
			file,
			state: { id: `u${++uploadCount}`, name: file.name, size: file.size, sent: 0, status: 'uploading', error: '' } as UploadState
		}));
		uploads = [...uploads, ...queued.map((item) => item.state)];
		const update = (id: string, patch: Partial<UploadState>) => {
			uploads = uploads.map((item) => (item.id === id ? { ...item, ...patch } : item));
		};
		for (const { file, state } of queued) {
			try {
				await uploadFile(file, target, (sent) => update(state.id, { sent }), inDrive);
				update(state.id, { status: 'done', sent: file.size });
				mcplEmit('drive.file.uploaded', 'drive', { size: file.size });
			} catch (err) {
				update(state.id, { status: 'failed', error: message(err, `${file.name} could not be uploaded.`) });
			}
			await refresh(folder, search);
		}
	}

	async function download(node: DriveNode) {
		problem = '';
		try {
			await downloadNode(node, accountOf(node));
			mcplEmit('drive.file.downloaded', 'drive', { size: node.size });
		} catch (err) {
			problem = message(err, `${node.name} could not be downloaded.`);
		}
	}
</script>

<section class="workspace">
{#if onGoogle}
	{#if google?.available}<Lesson lesson={googleLesson} progress={googleProgress} ondismiss={dismissGoogleLesson} />{/if}
	<GoogleDrive
		status={google}
		notice={googleNotice}
		problem={googleProblem}
		done={googleDone}
		files={googleFiles}
		path={googlePath}
		section={googleSection}
		search={googleSearch}
		more={googleNext !== null}
		busy={googleBusy}
		onconnect={connect}
		ondisconnect={disconnect}
		onsection={(next) => {
			googleSection = next;
			googlePath = [];
			googleSearch = '';
		}}
		onopen={(file) => {
			if (isFolder(file)) {
				googleSearch = '';
				googlePath = [...googlePath, { id: file.id, name: file.name }];
			}
		}}
		oncrumb={(index) => (googlePath = googlePath.slice(0, index + 1))}
		onsearch={(text) => {
			googlePath = [];
			googleSearch = text;
		}}
		onmore={() => loadGoogleFiles(googleNext ?? undefined)}
		onimport={bringOver}
		ondownload={fetchFromGoogle}
	/>
{:else}
	<Lesson {lesson} {progress} ondismiss={dismissLesson} />
	<DriveView
		title="Drive"
		{items}
		{crumbs}
		{folders}
		{usage}
		{uploads}
		{notice}
		{problem}
		{search}
		{scope}
		{canAdd}
		canSearch={!sharedRoot}
		canMoveToTop={scope === 'mine'}
		selfId={account()?.accountId ?? ''}
		onopen={open}
		onloadshares={(node) => loadShares(node.id, accountOf(node))}
		onfindperson={findPerson}
		onsaveshares={(node: DriveNode, shares: DriveShare[]) =>
			run(() => saveShares(node.id, shares, accountOf(node)), 'Sharing could not be changed.', () =>
				mcplEmit('drive.item.shared', 'drive', { people: shares.length })
			)}
		onupload={upload}
		onnewfolder={(name) =>
			run(() => createFolder(folder, name, drive).then(() => undefined), 'The folder could not be created.', () =>
				mcplEmit('drive.folder.created', 'drive')
			)}
		onrename={(node, name) =>
			run(() => renameNode(node.id, name, accountOf(node)), 'It could not be renamed.', () => mcplEmit('drive.item.renamed', 'drive'))}
		onmove={(node, target) =>
			run(() => moveNode(node.id, target, accountOf(node)), 'It could not be moved.', () => mcplEmit('drive.item.moved', 'drive'))}
		ondelete={(node) =>
			run(() => removeNode(node.id, accountOf(node)), 'It could not be deleted.', () => mcplEmit('drive.item.deleted', 'drive'))}
		ondownload={download}
		onactivate={(node) => {
			if (isDocName(node.name)) {
				const params = new URLSearchParams({ id: node.id });
				const inDrive = accountOf(node);
				if (inDrive) params.set('drive', inDrive);
				void goto(`/docs/edit?${params.toString()}`);
			} else {
				void download(node);
			}
		}}
		onsearch={(text) => (search = text)}
		onclearuploads={() => (uploads = uploads.filter((item) => item.status === 'uploading'))}
		oncopytogoogle={google?.connected && scope === 'mine' ? sendToGoogle : undefined}
	/>
{/if}
</section>

<style>
	.workspace { display: grid; gap: var(--space-2); }
</style>
