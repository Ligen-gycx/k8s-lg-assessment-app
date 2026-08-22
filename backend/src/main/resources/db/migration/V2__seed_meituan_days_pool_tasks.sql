update tasks
set title = '天数池基础规则配置',
    description = '配置会员天数余额、领取上限与有效期规则。',
    status = 'DONE'
where id = 1;

update tasks
set title = '商家活动天数投放联调',
    description = '模拟活动配置、批量投放和到账通知流程。',
    status = 'IN_PROGRESS'
where id = 2;

update tasks
set title = '运营日报与异常监控',
    description = '汇总天数池发放、领取、核销和异常告警数据。',
    status = 'TODO'
where id = 3;

insert into tasks(title, description, status)
select '运营日报与异常监控', '汇总天数池发放、领取、核销和异常告警数据。', 'TODO'
where not exists (select 1 from tasks where title = '运营日报与异常监控');
