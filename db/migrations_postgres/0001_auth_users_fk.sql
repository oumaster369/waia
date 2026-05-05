ALTER TABLE public.users
  ADD CONSTRAINT users_id_fk_auth_users
  FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;
