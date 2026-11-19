const searchInput = document.getElementById('search');
const categorySelect = document.getElementById('category');
const statusSelect = document.getElementById('status');
const rows = document.getElementById('rows');
const count = document.getElementById('count');
const message = document.getElementById('message');
const refresh = document.getElementById('refresh');
const details = document.getElementById('details');
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Shanghai', hourCycle: 'h23'
});
let allIssues = [];
let loaded = false;

function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

function mapLink(issue) {
    return 'index.html?issue=' + encodeURIComponent(issue.id);
}

let activeIssue = null;
let requestedId = new URLSearchParams(window.location.search).get('issue');
const editFields = document.getElementById('edit-fields');
const editDescription = document.getElementById('edit-description');
const editNote = document.getElementById('edit-note');
const editResult = document.getElementById('edit-result');
const advanceButton = document.getElementById('advance-issue');
const deleteButton = document.getElementById('delete-issue');

function openDetails(issue) {
    activeIssue = issue;
    editDescription.value = issue.description;
    editNote.value = issue.note || '';
    editResult.textContent = '';
    advanceButton.hidden = issue.status === 'resolved';
    advanceButton.textContent = issue.status === 'pending' ? '开始处理' : '标记已完成';
    deleteButton.hidden = !issue.is_mock;
    document.getElementById('detail-id').textContent = '工单 #' + issue.id;
    document.getElementById('detail-title').textContent = issue.title;
    const fields = document.getElementById('detail-fields');
    fields.replaceChildren();
    const info = [
        ['问题类别', getCategoryName(issue.category)], ['处理状态', getStatusName(issue.status)],
        ['上报时间', formatTime(issue.created_at)], ['问题来源', issue.source === 'student' ? '师生上报' : '巡检登记'],
        ['数据性质', issue.is_mock ? '教学模拟工单' : '实际工单'],
        ['更新时间', formatTime(issue.updated_at)],
        ['位置描述', issue.location_description], ['经纬度', issue.longitude + '，' + issue.latitude]
    ];
    for (const [label, value] of info) {
        const term = document.createElement('dt');
        const description = document.createElement('dd');
        term.textContent = label;
        description.textContent = value || '—';
        fields.append(term, description);
    }
    document.getElementById('detail-map').href = mapLink(issue);
    if (!details.open) details.showModal();
}

function issueRow(issue) {
    const row = document.createElement('tr');
    row.insertCell().textContent = '#' + issue.id + (issue.is_mock ? ' · 模拟' : '');
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'title-link';
    title.textContent = issue.title;
    title.addEventListener('click', () => openDetails(issue));
    row.insertCell().append(title);
    row.insertCell().textContent = getCategoryName(issue.category);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.status = issue.status;
    badge.textContent = getStatusName(issue.status);
    row.insertCell().append(badge);
    row.insertCell().textContent = formatTime(issue.created_at);
    const link = document.createElement('a');
    link.href = mapLink(issue);
    link.textContent = '地图定位';
    link.setAttribute('aria-label', '地图定位：' + issue.title);
    row.insertCell().append(link);
    return row;
}

function renderList() {
    if (!loaded) return;
    const query = searchInput.value.trim().toLowerCase();
    const filtered = allIssues.filter(issue => {
        const category = getCategoryName(issue.category) === '其他类别' ? 'other' : issue.category;
        const searchable = ['#' + issue.id, issue.title, issue.description].join(' ').toLowerCase();
        return (!categorySelect.value || categorySelect.value === category)
            && (!statusSelect.value || statusSelect.value === issue.status)
            && searchable.includes(query);
    });
    updateDashboard(filtered);
    const fragment = document.createDocumentFragment();
    filtered.forEach(issue => fragment.append(issueRow(issue)));
    rows.replaceChildren(fragment);
    count.textContent = filtered.length + ' / ' + allIssues.length + ' 条';
    message.hidden = filtered.length > 0;
    message.textContent = allIssues.length ? '没有符合当前条件的工单。' : '暂无工单。';
}

async function loadList() {
    if (refresh.disabled) return;
    refresh.disabled = true;
    refresh.textContent = '正在刷新…';
    try {
        const response = await fetch(API + '/api/issues', { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const records = await response.json();
        if (!Array.isArray(records)) throw new Error('工单数据格式错误');
        allIssues = records;
        loaded = true;
        renderList();
        if (requestedId) {
            const issue = allIssues.find(item => String(item.id) === requestedId);
            requestedId = null;
            if (issue) openDetails(issue);
            else {
                message.textContent = '这条工单已不存在。';
                message.hidden = false;
            }
        }
    } catch (error) {
        if (!loaded) {
            const panels = document.querySelectorAll('.chart');
            for (let i = 0; i < panels.length; i++) {
                panels[i].textContent = '工单数据加载失败';
            }
        }
        message.hidden = false;
        message.textContent = loaded ? '刷新失败，当前显示上次加载的工单。' : '工单加载失败，请确认后端已启动，再点击「刷新列表」。';
    } finally {
        refresh.disabled = false;
        refresh.textContent = '刷新列表';
    }
}

// 保存描述和处理说明，也可以把工单推进到下一个状态。
async function changeIssue(action) {
    if (!activeIssue || editFields.disabled) return;
    const issue = activeIssue;
    const deleting = action === 'delete';
    if (deleting && (!issue.is_mock || !confirm('确定删除模拟工单 #' + issue.id + '？'))) return;
    const changes = {};
    if (!deleting) {
        const description = editDescription.value.trim();
        if (!description) {
            editResult.textContent = '问题描述不能为空。';
            return;
        }
        if (description !== issue.description) changes.description = description;
        if (editNote.value.trim() !== issue.note) changes.note = editNote.value.trim();
        if (action === 'advance') {
            if (issue.status === 'pending') changes.status = 'processing';
            else if (issue.status === 'processing') changes.status = 'resolved';
        }
        if (!Object.keys(changes).length) {
            editResult.textContent = '没有需要保存的修改。';
            return;
        }
    }

    editFields.disabled = true;
    editResult.textContent = '正在保存…';
    try {
        let options = { method: 'DELETE' };
        if (!deleting) {
            options = { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(changes) };
        }
        const response = await fetch(API + '/api/issues/' + issue.id, options);
        if (!response.ok) {
            if (response.status === 409) throw new Error('状态已经变化，请关闭详情并刷新列表。');
            throw new Error('操作失败，请刷新列表核对工单后重试。');
        }
        if (deleting) {
            allIssues = allIssues.filter(item => item.id !== issue.id);
            if (activeIssue === issue && details.open) details.close();
        } else {
            const updated = await response.json();
            const index = allIssues.findIndex(item => item.id === issue.id);
            if (index >= 0) allIssues[index] = updated;
            if (activeIssue === issue && details.open) {
                openDetails(updated);
                editResult.textContent = '已保存';
            }
        }
        renderList();
        localStorage.setItem('campus-issues-updated', String(Date.now()));
    } catch (error) {
        editResult.textContent = error.message;
    } finally {
        editFields.disabled = false;
    }
}
document.getElementById('save-issue').addEventListener('click', function () { changeIssue('save'); });
advanceButton.addEventListener('click', function () { changeIssue('advance'); });
deleteButton.addEventListener('click', function () { changeIssue('delete'); });

searchInput.addEventListener('input', renderList);
categorySelect.addEventListener('change', renderList);
statusSelect.addEventListener('change', renderList);
const filtersForm = document.getElementById('filters');
filtersForm.addEventListener('submit', event => event.preventDefault());
filtersForm.addEventListener('reset', () => setTimeout(renderList, 0));
refresh.addEventListener('click', loadList);
window.addEventListener('pageshow', event => { if (event.persisted) loadList(); });
loadList();
