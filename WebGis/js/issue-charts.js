// 工单列表筛选后，把同一批记录交给四张图。
let chartIssues = [];
const trendRange = document.getElementById('trend-range');

// 每个容器只创建一次图表。刷新数据时更新已有图表。
function drawChart(id, option, description) {
    const panel = document.getElementById(id);
    panel.setAttribute('aria-label', description);
    if (!window.echarts) {
        panel.textContent = description;
        return;
    }
    let chart = echarts.getInstanceByDom(panel);
    if (!chart) {
        panel.textContent = '';
        chart = echarts.init(panel, null, { renderer: 'svg' });
        window.addEventListener('resize', function () {
            chart.resize();
        });
    }
    chart.setOption(option, true);
}

// 饼图和环形图都用名称、数量来画。内半径为 0 就是饼图。
function drawDistribution(id, title, items, colors, innerRadius) {
    const legends = [];
    let total = 0;
    for (let i = 0; i < items.length; i++) {
        legends.push(items[i].name + '  ' + items[i].value + ' 单');
        total += items[i].value;
    }
    drawChart(id, {
        color: colors,
        title: { show: total === 0, text: '暂无工单', left: 'center', top: 'middle',
            textStyle: { fontSize: 14, color: '#64748b' } },
        tooltip: { trigger: 'item', confine: true, formatter: '{b}：{c} 单（{d}%）' },
        legend: { show: total > 0, orient: 'vertical', right: '4%', top: 'middle',
            icon: 'circle', itemWidth: 10, itemHeight: 10, selectedMode: false,
            formatter: function (name) {
                for (let i = 0; i < items.length; i++) {
                    if (items[i].name === name) return legends[i];
                }
                return name;
            }
        },
        series: [{ type: 'pie', radius: [innerRadius, '72%'], center: ['28%', '50%'],
            stillShowZeroSum: false, label: { show: false }, data: items }]
    }, title + '，' + legends.join('，'));
}

function updateDashboard(issues) {
    chartIssues = issues;
    let pending = 0;
    let processing = 0;
    let resolved = 0;
    let light = 0;
    let road = 0;
    let facility = 0;
    let other = 0;

    // 第一步：每读到一条工单，就给对应的状态和类别加 1。
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        if (issue.status === 'pending') pending++;
        else if (issue.status === 'processing') processing++;
        else if (issue.status === 'resolved') resolved++;

        if (issue.category === 'light') light++;
        else if (issue.category === 'road') road++;
        else if (issue.category === 'facility') facility++;
        else other++;
    }
    document.getElementById('summary-total').textContent = issues.length;
    document.getElementById('summary-pending').textContent = pending;
    document.getElementById('summary-processing').textContent = processing;
    document.getElementById('summary-resolved').textContent = resolved;

    // 第二步：把相同的类别数量交给饼图和柱状图。
    const categories = [
        { name: '路灯', value: light }, { name: '道路', value: road },
        { name: '公共设施', value: facility }
    ];
    if (other > 0) categories.push({ name: '其他类别', value: other });
    const statuses = [
        { name: '待处理', value: pending }, { name: '处理中', value: processing },
        { name: '已完成', value: resolved }
    ];
    drawDistribution('status-chart', '工单状态分布', statuses, ['#ca654e','#d9a238','#39866a'], '47%');
    drawDistribution('category-chart', '工单类别分布', categories, ['#2873b4','#e29a39','#329a81','#93a1b2'], 0);

    const names = [];
    const amounts = [];
    const description = [];
    for (let i = 0; i < categories.length; i++) {
        names.push(categories[i].name);
        amounts.push(categories[i].value);
        description.push(categories[i].name + ' ' + categories[i].value + ' 单');
    }
    drawChart('comparison-chart', {
        grid: { left: 36, right: 15, top: 25, bottom: 32 },
        tooltip: { trigger: 'axis', confine: true },
        xAxis: { type: 'category', data: names },
        yAxis: { type: 'value', minInterval: 1 },
        series: [{ type: 'bar', color: '#2873b4', barMaxWidth: 42, data: amounts,
            label: { show: true, position: 'top' } }]
    }, '各类别工单数量，' + description.join('，'));
    updateTrend();
}

// 第三步：按北京时间取上报日期。先填满每天的 0，再逐单累加。
const dayFormat = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
});
function updateTrend() {
    const days = Number(trendRange.value);
    const today = new Date();
    const dates = [];
    const labels = [];
    const amounts = [];
    const oneDay = 24 * 60 * 60 * 1000;
    for (let i = days - 1; i >= 0; i--) {
        const day = dayFormat.format(new Date(today.getTime() - i * oneDay));
        dates.push(day);
        labels.push(day.slice(5));
        amounts.push(0);
    }
    for (let i = 0; i < chartIssues.length; i++) {
        if (!chartIssues[i].created_at) continue;
        const time = new Date(chartIssues[i].created_at);
        if (Number.isNaN(time.getTime())) continue;
        const index = dates.indexOf(dayFormat.format(time));
        if (index >= 0) amounts[index]++;
    }
    const description = [];
    for (let i = 0; i < dates.length; i++) {
        description.push(labels[i] + ' ' + amounts[i] + ' 单');
    }
    drawChart('trend-chart', {
        grid: { left: 36, right: 24, top: 20, bottom: 32 },
        tooltip: { trigger: 'axis', confine: true },
        xAxis: { type: 'category', data: labels, boundaryGap: false },
        yAxis: { type: 'value', minInterval: 1 },
        series: [{ name: '上报工单', type: 'line', data: amounts, color: '#2873b4',
            areaStyle: { color: '#e6f1fa' } }]
    }, '近 ' + days + ' 天上报趋势，' + description.join('，'));
}
trendRange.addEventListener('change', function () {
    if (loaded) updateTrend();
});
