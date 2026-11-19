const API = 'http://127.0.0.1:8000';

function getCategoryName(category) {

    if (category === 'light') {
        return '路灯';
    }

    if (category === 'road') {
        return '道路';
    }

    if (category === 'facility') {
        return '公共设施';
    }

    return '其他类别';
}

function getStatusName(status) {

    if (status === 'pending') {
        return '待处理';
    }

    if (status === 'processing') {
        return '处理中';
    }

    if (status === 'resolved') {
        return '已完成';
    }

    return '未知状态';
}
