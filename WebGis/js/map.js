
/* ==========================================
   第一部分：全局变量和地图配置
========================================== */

// 1. 创建 Leaflet 地图
// 当前没有瓦片底图，需要显式设置聚合插件使用的最大缩放级别。
const map = L.map('map', { maxZoom: 19 }).setView([22.5325, 113.9355], 16);
// 添加地图比例尺
L.control.scale({
    metric: true,
    imperial: false
}).addTo(map);
// 添加浅色地图底图
// CARTO Positron 浅色底图
L.tileLayer(
    'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
    {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxNativeZoom: 18,
        maxZoom: 20
    }
).addTo(map);
// 2. 创建工单聚合图层
let allIssueMarkers = [];
let activeStatus = null;
let issueLoadVersion = 0;

const issuemap = L.markerClusterGroup({

    iconCreateFunction: function (cluster) {

        // 获取当前聚合点里面的所有工单
        const markers = cluster.getAllChildMarkers();

        // 统计不同状态的工单数量
        const pending = markers.filter(
            marker => marker.options.issueStatus === 'pending'
        ).length;

        const processing = markers.filter(
            marker => marker.options.issueStatus === 'processing'
        ).length;

        const resolved = markers.filter(
            marker => marker.options.issueStatus === 'resolved'
        ).length;

        // 获取数量最多的状态对应的颜色
        let color;

        if (pending >= processing && pending >= resolved) {
            color = '#e74c3c';
        } else if (processing >= resolved) {
            color = '#f39c12';
        } else {
            color = '#27ae60';
        }

        // 获取聚合点里面的工单总数
        const total = markers.length;

        // 创建自定义聚合图标
        return L.divIcon({

    html: `
        <div style="
            width: 58px;
            height: 58px;
            background: white;
            border: 3px solid ${color};
            border-radius: 50%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        ">

            <div style="
                font-size: 20px;
                font-weight: bold;
                color: #333;
            ">
                ${total}
            </div>

            <div style="
                font-size: 10px;
                white-space: nowrap;
            ">
                <span style="color:#e74c3c">●${pending}</span>
                <span style="color:#f39c12">●${processing}</span>
                <span style="color:#27ae60">●${resolved}</span>
            </div>

        </div>
    `,

    className: 'custom-cluster',

    iconSize: [58, 58],

    iconAnchor: [29, 29]

});
    }

});

issuemap.addTo(map);

// 列表通过工单编号跳转，地图在加载标记后定位一次。
const requestedIssueId = new URLSearchParams(window.location.search).get('issue');
let issueLocationHandled = false;
let issueLocationFocused = false;

// 4. 保存当前选点标记和坐标
let pickMarker = null;
let selectedPoint = null;
let campusBounds = null;

// 5. 获取坐标显示区域
const coordPanel = document.getElementById('coord-panel');

// 6. 校园 GeoJSON 图层配置
const LAYERS = [
    {
        name: '绿地',
        file: 'green_area.geojson',
        color: '#B8D9B0',
        fill: 0.25,
        weight: 0.4
    },
    {
        name: '水面',
        file: 'water_area.geojson',
        color: '#8FC5DF',
        fill: 0.85,
        weight: 0.6
    },
    {
        name: '道路',
        file: 'road_area.geojson',
        color: '#FFFFFF',
        line: '#FFFFFF',
        fill: 1,
        weight: 0.5
    },
    {
        name: '建筑',
        file: 'building_area.geojson',
        color: '#C5CBD4',
        fill: 0.90,
        weight: 0.8
    },
    {
        name: '边界',
        file: 'detail_area.geojson',
        color: '#984FC1',
        fill: 0,
        weight: 2
    },
    {
        name: '功能分区', file: 'funct_area.geojson', pane: 'campusZones',
        color: '#667e9b', fill: 0.16, weight: 1.2, enabled: false, interactive: false
    },
    {
        name: '设施附属面', file: 'fct_attach_area.geojson', pane: 'campusDetails',
        color: '#a99477', fill: 0.24, weight: 0.8, minZoom: 17
    },
    {
        name: '设施附属线', file: 'fct_attach_line.geojson', pane: 'campusDetails',
        color: '#837265', weight: 1.3, minZoom: 18, interactive: false
    },
    {
        name: '道路附属线', file: 'rd_attach_line.geojson', pane: 'campusDetails',
        color: '#a39176', weight: 1, minZoom: 18, interactive: false
    },
    {
        name: '地名标注', file: 'ann_point.geojson', minZoom: 15
    }
];

map.createPane('campusZones').style.zIndex = 405;
map.getPane('campusZones').style.pointerEvents = 'none';
map.createPane('campusDetails').style.zIndex = 420;
map.createPane('campusNames').style.zIndex = 540;
map.getPane('campusNames').style.pointerEvents = 'none';

// 地名按原始显示级别排列，优先保留高等级地名，避开相互遮挡的文字。
function createCampusNames(geojson) {
    const group = L.layerGroup();
    const labels = geojson.features.map(feature => {
        const { name, dis_level } = feature.properties;
        const text = document.createElement('span');
        text.textContent = name;
        const width = Math.max(30, name.length * 13 + 8);
        const [lng, lat] = feature.geometry.coordinates;
        const marker = L.marker([lat, lng], {
            pane: 'campusNames', interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'campus-place-name', html: text,
                iconSize: [width, 20], iconAnchor: [width / 2, 10] })
        });
        return { marker, width, level: dis_level };
    }).sort((a, b) => a.level - b.level);

    function updateNames() {
        const zoom = map.getZoom();
        const size = map.getSize();
        const occupied = [];
        for (const { marker, width, level } of labels) {
            const { x, y } = map.latLngToContainerPoint(marker.getLatLng());
            const left = x - width / 2, right = x + width / 2;
            const visible = zoom >= Math.min(19, 15 + level) && right >= 0 && left <= size.x
                && y >= -10 && y <= size.y + 10
                && !occupied.some(box => left < box.right + 3 && right > box.left - 3 && Math.abs(y - box.y) < 21);
            if (visible) {
                occupied.push({ left, right, y });
                if (!group.hasLayer(marker)) group.addLayer(marker);
            } else if (group.hasLayer(marker)) {
                group.removeLayer(marker);
            }
        }
    }
    group.on('add', () => {
        updateNames();
        map.on('moveend resize', updateNames);
    });
    group.on('remove', () => {
        map.off('moveend resize', updateNames);
        group.clearLayers();
    });
    return group;
}


// ==========================================
// 第二部分：函数定义
// ==========================================


// 1. 加载校园 GeoJSON 图层
async function loadLayer(cfg) {

    const res = await fetch('data/' + cfg.file);

    if (!res.ok) {
        throw new Error('GeoJSON 加载失败：' + cfg.file);
    }

    const geojson = await res.json();

    if (cfg.file === 'ann_point.geojson') return createCampusNames(geojson);

    const interactive = cfg.interactive !== false && cfg.name !== '边界';
    return L.geoJSON(geojson, {

        pane: cfg.pane || 'overlayPane',
        interactive,
        style: feature => ({
            color: cfg.pane === 'campusZones'
                ? ({ 1: '#4584bb', 2: '#bb8153', 5: '#48896d' }[feature.properties.Type] || cfg.color)
                : cfg.line || cfg.color,
            weight: cfg.weight,
            fillColor: cfg.pane === 'campusZones' ? undefined : cfg.color,
            fillOpacity: cfg.fill
        }),

        onEachFeature: function (feature, layer) {

            if (!interactive) return;
            const p = feature.properties;

            layer.bindPopup(
                popupText(p.Name || cfg.name) +
                '<br>' +
                popupText(p.address || '') +
                (p.name_source === 'ann_point' ? '<br><small>名称来源：校园地名标注</small>' : '')
            );

            layer.on('click', function (e) {
                placeMarker(e.latlng);
            });
        }
    });

}


// 2. 添加图层控制复选框
function addLayerControl(cfg, layer) {

    const layerPanel = document.getElementById('layer-panel');

    const layerItem = document.createElement('label');
    layerItem.className = 'layer-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = cfg.enabled !== false;

    const layerName = document.createElement('span');
    layerName.textContent = cfg.name;
    const zoomHint = document.createElement('small');
    zoomHint.className = 'layer-zoom-hint';

    function updateVisibility() {
        const zoomVisible = !cfg.minZoom || map.getZoom() >= cfg.minZoom;
        const visible = checkbox.checked && zoomVisible;
        if (visible && !map.hasLayer(layer)) layer.addTo(map);
        if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
        zoomHint.textContent = checkbox.checked && !zoomVisible ? '放大至 ' + cfg.minZoom + ' 级' : '';
    }
    checkbox.addEventListener('change', updateVisibility);
    if (cfg.minZoom) map.on('zoomend', updateVisibility);
    layerItem.append(checkbox, layerName, zoomHint);
    updateVisibility();
    layerPanel.appendChild(layerItem);
}


// 3. 地图选点
function placeMarker(latlng) {
    resetNearby();

    // 删除上一次选点标记
    if (pickMarker) {
        map.removeLayer(pickMarker);
    }

    // 保存当前选点坐标
    selectedPoint = {
        latitude: latlng.lat,
        longitude: latlng.lng
    };

    // 创建新的选点标记
    pickMarker = L.marker(latlng).addTo(map);

    // 更新侧边栏坐标
    coordPanel.textContent =
        '纬度 ' + latlng.lat.toFixed(6) +
        ', 经度 ' + latlng.lng.toFixed(6);
}


// 4. 根据工单状态获取颜色
function getissuecolor(status) {

    if (status === 'pending') {
        return '#e74c3c';
    }

    if (status === 'processing') {
        return '#f39c12';
    }

    if (status === 'resolved') {
        return '#27ae60';
    }

    return '#808080';
}



// 6. 根据工单状态获取 Bootstrap 徽章样式
function getStatusBadgeClass(status) {

    if (status === 'pending') {
        return 'text-bg-danger';
    }

    if (status === 'processing') {
        return 'text-bg-warning';
    }

    if (status === 'resolved') {
        return 'text-bg-success';
    }

    return 'text-bg-secondary';
}



// 只更新工单聚合图层的内容，保留图层开关、校园图层和临时选点。
function applyIssueFilter() {
    const visible = activeStatus === null
        ? allIssueMarkers
        : allIssueMarkers.filter(marker => marker.options.issueStatus === activeStatus);

    issuemap.clearLayers();
    issuemap.addLayers(visible);
}

// 8. 加载后端工单
// 更新工单统计面板
function updateIssueStats(issues) {

    // 统计工单总数
    const total = issues.length;

    // 统计待处理工单
    const pending = issues.filter(function(issue) {
        return issue.status === 'pending';
    }).length;

    // 统计处理中工单
    const processing = issues.filter(function(issue) {
        return issue.status === 'processing';
    }).length;

    // 统计已完成工单
    const resolved = issues.filter(function(issue) {
        return issue.status === 'resolved';
    }).length;
    // 更新 HTML 页面中的统计数字
document.getElementById('total-count').textContent = total;

document.getElementById('pending-count').textContent = pending;

document.getElementById('processing-count').textContent = processing;

document.getElementById('resolved-count').textContent = resolved;

}
function locateRequestedIssue() {
    if (!requestedIssueId || issueLocationHandled) return;
    issueLocationHandled = true;
    const marker = allIssueMarkers.find(item => String(item.options.issueId) === requestedIssueId);
    const notice = document.getElementById('location-notice');
    if (!marker) {
        notice.textContent = '找不到这条工单，请返回工单管理核对。';
        notice.hidden = false;
        if (campusBounds) map.fitBounds(campusBounds, { padding: [20, 20], maxZoom: 17 });
        return;
    }
    issueLocationFocused = true;
    if (!map.hasLayer(issuemap)) issuemap.addTo(map);
    if (activeStatus !== null && activeStatus !== marker.options.issueStatus) {
        activeStatus = null;
        syncIssueFilterHighlights();
        applyIssueFilter();
    }
    map.setView(marker.getLatLng(), map.getMaxZoom(), { animate: false });
    issuemap.zoomToShowLayer(marker, () => marker.openPopup());
}

function popupText(value) {
    const span = document.createElement('span');
    span.textContent = value;
    return span.innerHTML;
}

async function loadIssues() {
    const version = ++issueLoadVersion;
    try {

        const res = await fetch(API + '/api/issues');

        if (!res.ok) {
            throw new Error('工单接口请求失败：' + res.status);
        }

        const issues = await res.json();
        // 报修后可能已发起新一轮加载，忽略较早请求的结果。
        if (version !== issueLoadVersion) return;
        updateIssueStats(issues);

        console.log('获取到的工单：', issues);

        // 先构建完整列表，再按当时选中的状态更新聚合图层。
        allIssueMarkers = issues.map(issue => {

            // 获取工单坐标
            const lat = Number(issue.latitude);
            const lng = Number(issue.longitude);

            // 根据工单状态获取颜色
            const color = getissuecolor(issue.status);
            // 根据工单状态创建不同颜色的图标
const issueIcon = L.divIcon({

    html: `
        <div style="
            width: 16px;
            height: 16px;
            background: ${color};
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 1px 5px rgba(0,0,0,0.4);
        "></div>
    `,

    className: 'issue-marker',

    iconSize: [20, 20],
    iconAnchor: [10, 10]
});

            // 创建工单圆形标记
           // 创建工单标记
            const marker = L.marker(
                [lat, lng],
                {
                    icon: issueIcon
                }
            );

            // 保存工单状态
            marker.options.issueStatus = issue.status;
            marker.options.issueId = issue.id;

            // 设置工单详情弹窗
            marker.bindPopup(`
                <div class="issue-popup">

                    <h5>工单详情</h5>

                    <hr>

                    <p>${issue.is_mock ? '教学模拟工单' : '工单'} #${issue.id}</p>
                    <p>上报时间：${popupText(new Date(issue.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</p>
                    <p>位置：${popupText(issue.location_description || '未填写')}</p>

                    <p>工单标题：${popupText(issue.title)}</p>

                    <p>工单类别：${getCategoryName(issue.category)}</p>

                    <p>
                        工单状态：
                        <span class="badge ${getStatusBadgeClass(issue.status)}">
                            ${getStatusName(issue.status)}
                        </span>
                    </p>

                    <p>
                        问题描述：${popupText(issue.description || '暂无描述')}
                    </p>

                </div>
            `);

            // 控制台输出工单信息
            console.log('工单编号：', issue.id);
            console.log('工单状态：', issue.status);
            return marker;
        });
        applyIssueFilter();
        locateRequestedIssue();

    } catch (error) {

        console.error('工单加载失败：', error);

    }
}


// 9. 创建测试工单标记
function testIssueMarker() {

    const marker = L.circleMarker(
        [22.53258, 113.9301],
        {
            radius: 8,
            color: '#e74c3c',
            fillColor: '#e74c3c',
            fillOpacity: 0.85
        }
    );

    marker.bindPopup('测试工单：路灯不亮');

    marker.addTo(issuemap);
}



// ==========================================
// 第三部分：事件绑定和程序启动
// ==========================================


// 1. 地图点击事件
map.on('click', function (e) {

    placeMarker(e.latlng);

});


// 2. 加载校园 GeoJSON 图层
(async function () {

    for (const cfg of LAYERS) {
        try {
            const layer = await loadLayer(cfg);
            addLayerControl(cfg, layer);
            if (cfg.file === 'detail_area.geojson') {
                campusBounds = layer.getBounds();
                if (!requestedIssueId || (issueLocationHandled && !issueLocationFocused)) {
                    map.fitBounds(campusBounds, { padding: [20, 20], maxZoom: 17 });
                }
            }
        } catch (error) {
            const warning = document.createElement('div');
            warning.textContent = cfg.name + '图层加载失败';
            document.getElementById('layer-panel').appendChild(warning);
            console.error(warning.textContent, error);
        }
    }
    loadFacilityPoints();
    addLayerControl({ name: '工单', enabled: map.hasLayer(issuemap) }, issuemap);
})();


// 3. 两组筛选控件在页面末尾统一绑定一次，刷新工单时无需重新绑定。
const issueFilterControls = document.querySelectorAll(
    '.status-filter[data-status], .stats-filter[data-status]'
);

function syncIssueFilterHighlights() {
    const selectedStatus = activeStatus === null ? 'all' : activeStatus;
    issueFilterControls.forEach(control => {
        const selected = control.dataset.status === selectedStatus;
        control.classList.toggle('active', selected);
        control.classList.toggle('bg-primary-subtle', selected);
    });
}

issueFilterControls.forEach(control => {
    control.addEventListener('click', () => {
        const status = control.dataset.status;
        // 总数始终显示全部；从任一组再次点击当前状态也恢复全部。
        activeStatus = (status === 'all' || status === activeStatus) ? null : status;
        syncIssueFilterHighlights();
        applyIssueFilter();
    });
});

syncIssueFilterHighlights();

loadIssues();


// 4. 绑定报修按钮点击事件
document.getElementById('report-btn').addEventListener('click', function () {

    // 判断用户是否已经选择位置
    if (selectedPoint === null) {

        alert('请先在地图上选择巡检问题的位置！');

        return;
    }

    // 显示报修表单
    document.getElementById('report-form').style.display = 'block';

});


const submitIssue = document.getElementById('submit-issue');
const nearbyResult = document.getElementById('nearby-result');
const categoryInput = document.getElementById('issue-category');
let confirmedMatches = '';
let pointVersion = 0;

function resetNearby() {
    pointVersion++;
    confirmedMatches = '';
    nearbyResult.replaceChildren();
    submitIssue.textContent = '提交工单';
}
categoryInput.addEventListener('change', resetNearby);

submitIssue.addEventListener('click', async function () {
    if (!selectedPoint || submitIssue.disabled) return;
    const issue = {
        category: categoryInput.value,
        source: document.getElementById('issue-source').value,
        title: document.getElementById('issue-title').value.trim(),
        description: document.getElementById('issue-description').value.trim(),
        location_description: document.getElementById('issue-location').value.trim(),
        latitude: selectedPoint.latitude, longitude: selectedPoint.longitude, is_mock: true
    };
    if (!issue.title || !issue.description) {
        nearbyResult.textContent = '请填写工单标题和问题描述。';
        confirmedMatches = '';
        submitIssue.textContent = '提交工单';
        return;
    }
    const version = pointVersion;
    submitIssue.disabled = true;
    try {
        // 每次提交前重新查询，类别或位置变化后需要重新确认。
        const params = new URLSearchParams({ lat: issue.latitude, lng: issue.longitude,
            category: issue.category, radius: 20 });
        const check = await fetch(API + '/api/issues/nearby?' + params, { cache: 'no-store' });
        if (!check.ok) throw new Error('附近工单查询失败，请重试。');
        const nearby = await check.json();
        if (version !== pointVersion) return;
        const signature = nearby.items.map(item => item.id).join(',');
        if (nearby.count > 0 && signature !== confirmedMatches) {
            nearbyResult.textContent = '20 米内有 ' + nearby.count + ' 条同类未解决工单：';
            for (const item of nearby.items) {
                const link = document.createElement('a');
                link.className = 'd-block';
                link.href = 'issues.html?issue=' + encodeURIComponent(item.id);
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = '查看 #' + item.id + ' · ' + getStatusName(item.status) + ' · ' + item.distance_m + ' 米';
                nearbyResult.append(link);
            }
            confirmedMatches = signature;
            submitIssue.textContent = '仍要提交新工单';
            return;
        }
        const response = await fetch(API + '/api/issues', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(issue)
        });
        if (!response.ok) throw new Error('工单创建失败，请检查填写内容后重试。');
        const result = await response.json();
        if (pointVersion === version) {
            if (pickMarker) map.removeLayer(pickMarker);
            pickMarker = null;
            selectedPoint = null;
            coordPanel.textContent = '未选择';
            document.getElementById('report-form').style.display = 'none';
            for (const id of ['issue-title', 'issue-description', 'issue-location']) {
                document.getElementById(id).value = '';
            }
            resetNearby();
        }
        await loadIssues();
        alert('已登记教学模拟工单 #' + result.id);
    } catch (error) {
        if (pointVersion === version) nearbyResult.textContent = error.message;
    } finally {
        submitIssue.disabled = false;
    }
});

async function loadFacilityPoints() {
    try {
        const response = await fetch(API + '/api/facilities');
        if (!response.ok) throw new Error();
        const facilities = await response.json();
        const group = L.layerGroup();
        for (const f of facilities) {
            const marker = L.circleMarker([f.latitude, f.longitude], {
                radius: 6, color: '#165b66', weight: 2, fillColor: '#61cfc2', fillOpacity: 1
            });
            marker.bindPopup('<strong>' + popupText(f.name) + '</strong><br>设施编号：' + f.id
                + '<br>类别：' + popupText(getCategoryName(f.category))
                + '<br>经纬度：' + f.longitude + '，' + f.latitude
                + '<br>数据来源：' + popupText(f.source) + (f.is_mock ? '（教学模拟）' : ''));
            marker.on('click', function () { placeMarker(marker.getLatLng()); });
            marker.addTo(group);
        }
        addLayerControl({ name: '公共设施点' }, group);
    } catch (error) {
        const info = document.createElement('p');
        info.textContent = '公共设施点加载失败，请刷新页面重试。';
        document.getElementById('layer-panel').append(info);
    }
}
window.addEventListener('pageshow', function (event) {
    if (event.persisted) loadIssues();
});
window.addEventListener('storage', function (event) {
    if (event.key === 'campus-issues-updated') loadIssues();
});
document.getElementById('reset-map-btn')
    .addEventListener('click', function () {

       map.fitBounds(campusBounds, {
    padding: [10, 10],
    maxZoom: 17
});

    });


// ==========================================
// 第四部分：测试代码
// ==========================================

// 需要测试时，取消下面这行代码的注释
// testIssueMarker();
10
