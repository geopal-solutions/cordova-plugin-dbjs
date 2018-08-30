SELECT
	count(*) as cnt
FROM
	sqlite_master
WHERE
	type='table'
	and name = :name
order by
	name asc
