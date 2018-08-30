select
	*
from
	people
where 1 = 1
	-- firstname --      and first_name = :firstname
	-- lastname --       and last_name = :lastname
	-- age --            and age = :age
	-- age_min --        and age >= :age_min
	-- age_max --        and age <= :age_max
	-- favnum --         and favorite_number = :favnum
	-- favnum_min --     and favorite_number >= :favnum_min
	-- favnum_max --     and favorite_number <= :favnum_max
	-- nationality --    and nationality = :nationality
	-- %firstname% --    and first_name like :%firstname%
	-- %lastname% --     and last_name like :%lastname%
	-- %nationality% --  and nationality like :%nationality%
order by
	-- sort:first_name --      first_name asc,
	-- sort:first_name asc --  first_name asc,
	-- sort:first_name desc -- first_name desc,
	-- sort:last_name --       last_name asc,
	-- sort:last_name asc --   last_name asc,
	-- sort:last_name desc --  last_name desc,
	-- sort:favnum --          favorite_number asc,
	-- sort:favnum asc --      favorite_number asc,
	-- sort:favnum desc --     favorite_number desc,
	age asc